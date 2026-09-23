import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setCurrentUserId } from "./identity";
import { actionResultsSummary, applyActionsToLocalRecords } from "./aiActionRunner";
import type { Anniversary, AnniversaryKind, EventItem, SyncFields } from "../types";

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
});

describe("AI 动作结果汇总", () => {
  it("相同标题合并显示数量", () => {
    const records = Array.from({ length: 9 }, (_, index) => ({
      table: "events" as const,
      record: event(`event-${index}`, "2026-09-21")
    }));

    expect(actionResultsSummary({ created: records, updated: [], deleted: [], unmatched: [] })).toBe(
      "已创建事项：设计与制造基础3课程设计（9 个）"
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
      "已创建事项：设计与制造基础3课程设计",
      "已创建备忘录：购物清单",
      "已修改事项：设计与制造基础3课程设计",
      "已删除事项：设计与制造基础3课程设计"
    ].join("\n"));
  });

  it("没有任何动作时返回空字符串", () => {
    expect(actionResultsSummary({ created: [], updated: [], deleted: [], unmatched: [] })).toBe("");
  });
});
