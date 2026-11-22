import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { db } from "../db";
import { setCurrentUserId } from "./identity";
import { actionResultsSummary, applyActionsToLocalRecords, assistantReplyAfterActions } from "./aiActionRunner";
import type { Anniversary, AnniversaryKind, EventItem, SyncFields } from "../types";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";
import { getMemoChecklistStats } from "./memoFormatting";

const userId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-09-20T00:00:00.000Z";

function fields(id: string, owner = userId): SyncFields {
  return {
    id,
    user_id: owner,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111"
  };
}

function event(id: string, startDate: string, owner = userId): EventItem {
  return {
    ...fields(id, owner),
    event_type: "event",
    title: "设计与制造基础3课程设计",
    start_date: startDate,
    end_date: startDate,
    start_time: "08:00",
    end_time: "10:00",
    all_day: false,
    category_id: null,
    color: "#e36b32",
    location: "",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    recurrence_interval: 1,
    reminder_enabled: true,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    completed_at: null
  };
}

function anniversary(id: string, title: string, kind: AnniversaryKind = "holiday", owner = userId): Anniversary {
  return {
    ...fields(id, owner),
    kind,
    title,
    date: "2026-08-15",
    color: "#059669",
    note: "",
    reminder_enabled: false,
    reminder_days_before: 0,
    reminder_time: "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai"
  };
}

describe("AI 动作执行器", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId(userId);
    await db.events.clear();
    await db.anniversaries.clear();
    await db.eventOccurrenceStates.clear();
    await db.focusSessions.clear();
    await db.syncQueue.clear();
    await db.memos.clear();
    await db.memoFolders.clear();
  });

  it("查询已有事项期间取消后不会执行删除", async () => {
    const original = event("cancel-delete", "2026-09-21");
    await db.events.put(original);
    const controller = new AbortController();
    const cancelOnRead = (row: EventItem) => { controller.abort(); return row; };
    db.events.hook("reading", cancelOnRead);
    try {
      await expect(applyActionsToLocalRecords([{ type: "delete_event", title: original.title }], "删除", userId, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      db.events.hook("reading").unsubscribe(cancelOnRead);
    }
    expect(await db.events.get(original.id)).toEqual(original);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("写入过程中取消回滚当前未提交动作和队列，不继续创建后续记录", async () => {
    const controller = new AbortController();
    const cancelOnCreate = () => { controller.abort(); };
    db.memos.hook("creating", cancelOnCreate);
    try {
      await expect(applyActionsToLocalRecords([
        { type: "create_memo", title: "第一条" },
        { type: "create_memo", title: "第二条" }
      ], "记录", userId, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      db.memos.hook("creating").unsubscribe(cancelOnCreate);
    }
    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("首个动作已提交后取消保留该动作，但不执行下一条", async () => {
    const controller = new AbortController();
    const cancelAfterCommit = () => {
      let transaction = Dexie.currentTransaction!;
      while (transaction.parent) transaction = transaction.parent;
      transaction.on("complete", () => controller.abort());
    };
    db.memos.hook("creating", cancelAfterCommit);
    try {
      await expect(applyActionsToLocalRecords([
        { type: "create_memo", title: "已提交" },
        { type: "create_memo", title: "尚未开始" }
      ], "记录", userId, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      db.memos.hook("creating").unsubscribe(cancelAfterCommit);
    }
    expect(await db.memos.toArray()).toEqual([expect.objectContaining({ title: "已提交" })]);
    expect(await db.syncQueue.count()).toBe(1);
  });

  it("修改动作按标题更新全部同类课程安排", async () => {
    await db.events.bulkPut([
      event("event-1", "2026-09-21"),
      event("event-2", "2026-09-23"),
      event("event-3", "2026-09-25")
    ]);

    const results = await applyActionsToLocalRecords([{
      type: "update_event",
      title: "设计与制造基础3课程设计",
      startTime: "10:00",
      endTime: "12:00",
      reminderMinutesBefore: 15
    }], "把上课时间改成上午十点", userId);

    expect(results.updated).toHaveLength(3);
    expect(results.deleted).toHaveLength(0);
    const stored = await db.events.orderBy("id").toArray();
    expect(stored.map((item) => item.start_time)).toEqual(["10:00", "10:00", "10:00"]);
    expect(stored.map((item) => item.reminder_minutes_before)).toEqual([15, 15, 15]);
  });

  it("可用日期限定只修改指定的那次课", async () => {
    await db.events.bulkPut([event("event-1", "2026-09-21"), event("event-2", "2026-09-23")]);

    const results = await applyActionsToLocalRecords([{
      type: "update_event",
      title: "设计与制造基础3课程设计",
      date: "2026-09-23",
      allDay: true
    }], "9月23日那次改成全天", userId);

    expect(results.updated.map((item) => item.updated.id)).toEqual(["event-2"]);
    expect((await db.events.get("event-1"))?.all_day).toBe(false);
    expect((await db.events.get("event-2"))?.all_day).toBe(true);
  });

  it("删除动作移除匹配事项并写入同步队列", async () => {
    await db.events.bulkPut([event("event-1", "2026-09-21"), event("event-2", "2026-09-23")]);

    const results = await applyActionsToLocalRecords([{
      type: "delete_event",
      title: "设计与制造基础3课程设计"
    }], "把之前建错的课程删掉", userId);

    expect(results.deleted.map((item) => item.id).sort()).toEqual(["event-1", "event-2"]);
    expect(await db.events.count()).toBe(0);
    expect((await db.syncQueue.toArray()).every((item) => item.operation === "delete")).toBe(true);
  });

  it("不会修改或删除其他账号的事项", async () => {
    await db.events.put(event("event-other", "2026-09-21", "44444444-4444-4444-8444-444444444444"));

    const results = await applyActionsToLocalRecords([
      { type: "update_event", title: "设计与制造基础3课程设计", startTime: "11:00" },
      { type: "delete_event", title: "设计与制造基础3课程设计" }
    ], "修改并删除", userId);

    expect(results.updated).toHaveLength(0);
    expect(results.deleted).toHaveLength(0);
    expect((await db.events.get("event-other"))?.start_time).toBe("08:00");
  });

  it("同一批次不会重复删除同一事项", async () => {
    await db.events.put(event("event-1", "2026-09-21"));

    const results = await applyActionsToLocalRecords([
      { type: "delete_event", title: "设计与制造基础3课程设计" },
      { type: "delete_event", title: "设计与制造基础3课程设计" }
    ], "删除", userId);

    expect(results.deleted.map((item) => item.id)).toEqual(["event-1"]);
  });

  it("找不到匹配事项时如实记录未匹配项", async () => {
    const results = await applyActionsToLocalRecords([
      { type: "update_event", title: "并不存在的课程", startTime: "10:00" },
      { type: "delete_event", title: "另一个不存在的事项" }
    ], "修改并删除", userId);

    expect(results.updated).toHaveLength(0);
    expect(results.deleted).toHaveLength(0);
    expect(results.unmatched).toEqual([
      { action: "update", title: "并不存在的课程" },
      { action: "delete", title: "另一个不存在的事项" }
    ]);
    expect(actionResultsSummary(results)).toBe([
      "未找到要修改的事项：并不存在的课程",
      "未找到要删除的事项：另一个不存在的事项"
    ].join("\n"));
  });

  it("标题只差空格或标点时仍能匹配", async () => {
    await db.events.put({ ...event("event-1", "2026-09-21"), title: "设计与制造基础 3 课程设计" });

    const results = await applyActionsToLocalRecords([{
      type: "update_event",
      title: "设计与制造基础3课程设计",
      startTime: "14:00"
    }], "改成下午两点", userId);

    expect(results.updated.map((item) => item.updated.id)).toEqual(["event-1"]);
    expect((await db.events.get("event-1"))?.start_time).toBe("14:00");
  });

  it("简称只在指向唯一标题时生效，含糊简称不误删", async () => {
    await db.events.put({ ...event("event-1", "2026-09-21"), title: "高等数学（上）" });

    const unique = await applyActionsToLocalRecords([{
      type: "delete_event",
      title: "高等数学"
    }], "删掉高等数学", userId);
    expect(unique.deleted.map((item) => item.id)).toEqual(["event-1"]);

    await db.events.bulkPut([
      { ...event("event-2", "2026-09-21"), title: "高等数学（上）" },
      { ...event("event-3", "2026-09-22"), title: "高等数学（下）" }
    ]);
    const ambiguous = await applyActionsToLocalRecords([{
      type: "delete_event",
      title: "高等数学"
    }], "删掉高等数学", userId);

    expect(ambiguous.deleted).toHaveLength(0);
    expect(ambiguous.unmatched).toEqual([{ action: "delete", title: "高等数学" }]);
    expect(await db.events.count()).toBe(2);
  });

  it("可让 AI 把已有农历节日批量从固定公历转换为农历", async () => {
    await db.anniversaries.bulkPut([
      anniversary("mid-autumn", "中秋节"),
      anniversary("dragon-boat", "端午节"),
      anniversary("national-day", "国庆节"),
      anniversary("birthday", "妈妈生日", "birthday")
    ]);

    // Even if the model only answers in prose, this unambiguous bulk command
    // is recovered locally instead of silently doing nothing.
    const results = await applyActionsToLocalRecords([], "把农历节日全部从公历改成农历", userId);

    expect(results.updated.map((item) => item.updated.title).sort()).toEqual(["中秋节", "端午节"]);
    expect(await db.anniversaries.get("mid-autumn")).toMatchObject({
      calendar_type: "lunar",
      lunar_year: 2026,
      lunar_month: 8,
      lunar_day: 15,
      date: "2026-09-25"
    });
    expect(await db.anniversaries.get("dragon-boat")).toMatchObject({ calendar_type: "lunar", lunar_month: 5, lunar_day: 5 });
    expect((await db.anniversaries.get("national-day"))?.calendar_type).toBeUndefined();
    expect((await db.anniversaries.get("birthday"))?.calendar_type).toBeUndefined();
  });

  it("按标题修改农历生日，不依赖内置节日名称", async () => {
    await db.anniversaries.put(anniversary("birthday", "妈妈生日", "birthday"));

    const results = await applyActionsToLocalRecords([{
      type: "update_anniversary",
      scope: "title",
      title: "妈妈生日",
      calendarType: "lunar",
      lunarYear: 2026,
      lunarMonth: 8,
      lunarDay: 15
    }], "把妈妈生日改成农历八月十五", userId);

    expect(results.updated).toHaveLength(1);
    expect(await db.anniversaries.get("birthday")).toMatchObject({
      calendar_type: "lunar",
      lunar_month: 8,
      lunar_day: 15,
      date: "2026-09-25"
    });
  });

  it("已错误迁移成农历的传统节日也重新校准，其他用户和公历节日保持原样", async () => {
    const bad = { ...anniversary("bad-mid-autumn", "中秋节"), calendar_type: "lunar" as const,
      lunar_year: 2026, lunar_month: 9, lunar_day: 17, lunar_is_leap_month: true,
      lunar_occurrence_dates: ["2026-10-27"], date: "2026-10-27", reminder_sent_for: "2026-10-27" };
    const national = anniversary("solar", "国庆节");
    const other = { ...bad, id: "other-user", user_id: "other-user" };
    await db.anniversaries.bulkPut([bad, national, other]);
    const first = await applyActionsToLocalRecords([], "把所有传统节日改成农历", userId);
    expect(first.created).toHaveLength(0);
    expect(first.updated).toHaveLength(1);
    expect(await db.anniversaries.get(bad.id)).toMatchObject({ calendar_type: "lunar", lunar_year: 2026,
      lunar_month: 8, lunar_day: 15, lunar_is_leap_month: false, date: "2026-09-25", reminder_sent_for: null });
    expect(await db.anniversaries.get(national.id)).toEqual(national);
    expect(await db.anniversaries.get(other.id)).toEqual(other);
    await applyActionsToLocalRecords([], "把所有传统节日改成农历", userId);
    expect(await db.anniversaries.count()).toBe(3);
  });

  it("修改事项日期时使用原文农历日期并加入同步队列", async () => {
    const original = { ...event("lunar-event", "2026-11-09"), title: "提交材料" };
    await db.events.put(original);
    const result = await applyActionsToLocalRecords([{ type: "update_event", title: "提交材料", startDate: "2026-11-09", endDate: "2026-11-09" }],
      "把提交材料改成2026年农历十一月初九", userId);
    expect(result.updated).toHaveLength(1);
    expect(await db.events.get(original.id)).toMatchObject({ start_date: "2026-12-17", end_date: "2026-12-17" });
    expect(await db.syncQueue.where("record_id").equals(original.id).count()).toBe(1);
  });

  it("14个日期区间分别保存，文件夹归属、备注、勾选清单及同步队列都真实写入", async () => {
    const ranges = [
      ["2026-11-22", "2026-11-28"], ["2026-11-29", "2026-12-02"], ["2026-12-03", "2026-12-06"],
      ["2026-12-07", "2026-12-09"], ["2026-12-10", "2026-12-13"], ["2026-12-14", "2026-12-15"],
      ["2026-12-16", "2026-12-17"], ["2026-12-18", "2026-12-19"], ["2026-12-20", "2026-12-20"],
      ["2026-12-21", "2026-12-24"], ["2026-12-25", "2026-12-27"], ["2026-12-28", "2027-01-03"],
      ["2027-01-04", "2027-01-08"], ["2027-01-09", "2027-01-12"]
    ];
    const note = "具体内容：" + "完整保留公式、章节与结构参数。".repeat(25) + "\n预期成果：开题报告与PPT";
    const events: DeepSeekAssistantAction[] = ranges.map(([startDate, endDate], index) => ({
      type: "create_event", title: `阶段${index + 1}`, startDate, endDate, allDay: true, note, reminderEnabled: true
    }));
    const results = await applyActionsToLocalRecords([
      ...events,
      { type: "create_memo_folder", name: "毕设" },
      { type: "create_memo", title: "开题前准备", folderName: "毕设", format: "numbered", items: ranges.map(([start, end], index) => ({ text: `${start} 至 ${end} 阶段${index + 1}\n${note}` })) }
    ], "按表格记录到全天事项，不用提醒，新建毕设文件夹和开题前准备备忘录，用可勾选待办", userId);
    expect(await db.events.count()).toBe(14);
    const saved = await db.events.orderBy("start_date").toArray();
    expect(saved.map((item) => [item.start_date, item.end_date])).toEqual(ranges);
    expect(saved.every((item) => item.all_day && !item.reminder_enabled && item.note === note && item.recurrence_type === "none")).toBe(true);
    const folder = (await db.memoFolders.toArray())[0];
    expect(folder).toMatchObject({ name: "毕设", user_id: userId });
    const memo = (await db.memos.toArray())[0];
    expect(memo).toMatchObject({ title: "开题前准备", folder_id: folder.id });
    expect(getMemoChecklistStats(memo.content)).toEqual({ total: 14, completed: 0, incomplete: 14 });
    expect(results.created).toHaveLength(16);
    expect(await db.syncQueue.count()).toBe(16);
    const reply = assistantReplyAfterActions("已创建一个12月21日事项，文件夹需手动选择。", results, 16, "创建");
    expect(reply).toContain("2026-12-28 至 2027-01-03");
    expect(reply).toContain("14 条可勾选待办");
    expect(reply).toContain("文件夹：毕设");
    expect(reply).not.toContain("手动选择");
  });

  it("复用当前账号的同名文件夹，不使用其他账号或已删除的文件夹", async () => {
    await db.memoFolders.bulkPut([
      { ...fields("other-folder", "other-user"), name: "毕设", sort_order: 1 },
      { ...fields("deleted-folder"), name: "毕设", sort_order: 1, deleted_at: createdAt },
      { ...fields("own-folder"), name: "毕设", sort_order: 2 }
    ]);
    const results = await applyActionsToLocalRecords([
      { type: "create_memo_folder", name: "毕设" },
      { type: "create_memo", title: "研究清单", folderName: "毕设", format: "checklist", items: [{ text: "查文献" }] }
    ], "创建", userId);
    expect(await db.memoFolders.count()).toBe(3);
    expect((await db.memos.toArray())[0].folder_id).toBe("own-folder");
    expect(results.created.filter((item) => item.table === "memoFolders")).toHaveLength(0);
  });

  it("不允许把备忘录放进其他账号的文件夹，并在写入任何事项前拒绝", async () => {
    await db.memoFolders.put({ ...fields("other-folder", "other-user"), name: "毕设", sort_order: 1 });
    await expect(applyActionsToLocalRecords([
      { type: "create_event", title: "不应创建", startDate: "2026-12-21" },
      { type: "create_memo", title: "不应保存", folderId: "other-folder" }
    ], "创建", userId)).rejects.toThrow("不属于当前账号");
    expect(await db.events.count()).toBe(0);
    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("按文件夹ID归档，多个同名文件夹需要明确选择", async () => {
    await db.memoFolders.bulkPut([
      { ...fields("folder-1"), name: "毕设", sort_order: 1 },
      { ...fields("folder-2"), name: "毕设", sort_order: 2 }
    ]);
    await expect(applyActionsToLocalRecords([{ type: "create_memo", title: "清单", folderName: "毕设" }], "创建", userId)).rejects.toThrow("多个");
    await applyActionsToLocalRecords([{ type: "create_memo", title: "清单", folderId: "folder-2" }], "创建", userId);
    expect((await db.memos.toArray())[0].folder_id).toBe("folder-2");
  });

  it("自动创建文件夹后备忘录保存失败时一起回滚，不留下文件夹和同步记录", async () => {
    const failMemo = () => { throw new Error("模拟保存失败"); };
    db.memos.hook("creating", failMemo);
    try {
      await expect(applyActionsToLocalRecords([{ type: "create_memo", title: "清单", folderName: "毕设" }], "创建", userId)).rejects.toThrow("模拟保存失败");
    } finally {
      db.memos.hook("creating").unsubscribe(failMemo);
    }
    expect(await db.memoFolders.count()).toBe(0);
    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("部分写入失败时如实保留已提交结果并说明未完成操作", async () => {
    const failSecond = (_key: unknown, memo: { title: string }) => { if (memo.title === "第二条") throw new Error("第二条保存失败"); };
    db.memos.hook("creating", failSecond);
    try {
      const results = await applyActionsToLocalRecords([
        { type: "create_memo", title: "第一条" }, { type: "create_memo", title: "第二条" }, { type: "create_memo", title: "第三条" }
      ], "创建备忘录", userId);
      expect(results.created).toHaveLength(1);
      expect(await db.memos.count()).toBe(1);
      const reply = assistantReplyAfterActions("已全部创建成功", results, 3, "创建备忘录");
      expect(reply).toContain("已创建备忘录：第一条");
      expect(reply).toContain("部分操作未完成");
      expect(reply).not.toContain("已全部创建成功");
      expect(reply).not.toContain("已创建备忘录：第二条");
    } finally {
      db.memos.hook("creating").unsubscribe(failSecond);
    }
  });

  it("图片任务整批提交，末尾备忘录失败时回滚前面事项、文件夹及全部同步记录", async () => {
    const failMemo = () => { throw new Error("模拟备忘录失败"); };
    db.memos.hook("creating", failMemo);
    try {
      await expect(applyActionsToLocalRecords([
        { type: "create_event", title: "第一张图片任务", startDate: "2026-12-21", sourceKey: "image-1:row:1" },
        { type: "create_event", title: "第三张图片任务", startDate: "2027-01-04", sourceKey: "image-3:row:1" },
        { type: "create_memo_folder", name: "毕设" },
        { type: "create_memo", title: "开题前准备", folderName: "毕设", sourceKey: "all-images:memo", format: "checklist", items: [{ text: "两项任务" }] }
      ], "重新处理", userId)).rejects.toThrow("模拟备忘录失败");
    } finally { db.memos.hook("creating").unsubscribe(failMemo); }
    expect(await db.events.count()).toBe(0);
    expect(await db.memoFolders.count()).toBe(0);
    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("重新处理同批附件不会重复创建，已勾选的备忘录内容保留", async () => {
    const actions: DeepSeekAssistantAction[] = [
      { type: "create_event", title: "第一张图片任务", startDate: "2026-12-21", sourceKey: "image-1:row:1" },
      { type: "create_event", title: "第三张图片任务", startDate: "2027-01-04", sourceKey: "image-3:row:1" },
      { type: "create_memo_folder", name: "毕设" },
      { type: "create_memo", title: "开题前准备", folderName: "毕设", sourceKey: "all-images:memo", format: "checklist", items: [{ text: "第一项" }, { text: "第二项" }] }
    ];
    const initial = await applyActionsToLocalRecords(actions, "重新处理", userId);
    expect(initial.created).toHaveLength(4);
    const memo = (await db.memos.toArray())[0];
    await db.memos.put({ ...memo, content: memo.content.replace("○", "●") });
    const repeated = await applyActionsToLocalRecords(actions.map((action) => action.type === "create_event" ? { ...action, title: action.title + "学习" } : action), "重新处理", userId);
    expect(repeated.created).toHaveLength(0);
    expect(repeated.reused).toHaveLength(3);
    expect(await db.events.count()).toBe(2);
    expect(await db.memos.count()).toBe(1);
    expect(await db.memoFolders.count()).toBe(1);
    expect((await db.memos.get(memo.id))?.content).toBe("● 第一项\n○ 第二项");
    expect(await db.syncQueue.count()).toBe(4);
    expect(actionResultsSummary(repeated)).toContain("未重复创建");
  });
});

describe("AI 动作结果汇总", () => {
  it("纪念日结果显示实际保存的历法原日期及换算后的下次日期", () => {
    const record = { ...anniversary("lunar-summary", "家人生日", "birthday"), calendar_type: "lunar" as const,
      lunar_year: 2005, lunar_month: 2, lunar_day: 25, lunar_is_leap_month: false, date: "2005-04-03" };
    const summary = actionResultsSummary({ created: [{ table: "anniversaries", record }], updated: [], deleted: [], unmatched: [] });
    expect(summary).toContain("已创建日子：家人生日（农历 2005年二月廿五，下次 ");
    expect(summary).toMatch(/下次 \d{4}-\d{2}-\d{2}）/);
  });

  it("相同标题合并显示数量", () => {
    const records = Array.from({ length: 9 }, (_, index) => ({
      table: "events" as const,
      record: event(`event-${index}`, "2026-09-21")
    }));

    expect(actionResultsSummary({ created: records, updated: [], deleted: [], unmatched: [] })).toBe(
      "已创建事项：设计与制造基础3课程设计（2026-09-21，08:00-10:00，已启用提醒）（9 个）"
    );
  });

  it("分开罗列不同标题，并区分新增、修改和删除", () => {
    const created = [
      { table: "events" as const, record: event("event-1", "2026-09-21") },
      { table: "memos" as const, record: { ...fields("memo-1"), folder_id: null, title: "购物清单", content: "", is_pinned: false } }
    ];
    const summary = actionResultsSummary({
      created,
      updated: [{ original: event("event-2", "2026-09-23"), updated: event("event-2", "2026-09-23") }],
      deleted: [event("event-3", "2026-09-25")],
      unmatched: []
    });

    expect(summary).toBe([
      "已创建事项：设计与制造基础3课程设计（2026-09-21，08:00-10:00，已启用提醒）",
      "已创建备忘录：购物清单",
      "已修改事项：设计与制造基础3课程设计",
      "已删除事项：设计与制造基础3课程设计"
    ].join("\n"));
  });

  it("没有任何动作时返回空字符串", () => {
    expect(actionResultsSummary({ created: [], updated: [], deleted: [], unmatched: [] })).toBe("");
  });

  it("没有动作时不能显示模型编造的创建成功，但保留正常回答和澄清问题", () => {
    const empty = { created: [], updated: [], deleted: [], unmatched: [] };
    expect(assistantReplyAfterActions("已创建毕设文件夹和可勾选清单", empty, 0, "创建文件夹和备忘录")).toContain("未执行任何操作");
    expect(assistantReplyAfterActions("请问要创建在哪一天？", empty, 0, "创建事项")).toBe("请问要创建在哪一天？");
    expect(assistantReplyAfterActions("这是论文的主要方法。", empty, 0, "解释论文")).toBe("这是论文的主要方法。");
  });
});
