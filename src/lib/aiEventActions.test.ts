import { describe, expect, it } from "vitest";
import { anniversaryFromAiAction, applyEventUpdate, eventItemFromAiAction, matchEventsByTitle, memoFromAiAction, recordsFromAiActions, resolveHoliday, resolveHolidays } from "./aiEventActions";
import type { EventItem } from "../types";

describe("AI 助手创建动作", () => {
  it("把 AI 返回的定时事项转换为本地事项", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "交作业",
      startDate: "2026-07-09",
      startTime: "09:00",
      endTime: "09:00",
      allDay: false,
      location: "图书馆二楼",
      note: "数学作业",
      reminderEnabled: true,
      reminderMinutesBefore: 30
    }, "明天 9:00 添加交作业", "user-1");

    expect(event).toMatchObject({
      user_id: "user-1",
      event_type: "event",
      title: "交作业",
      start_date: "2026-07-09",
      end_date: "2026-07-09",
      start_time: "09:00",
      end_time: "09:00",
      all_day: false,
      location: "图书馆二楼",
      reminder_enabled: true,
      reminder_minutes_before: 30
    });
    expect(event?.note).toBe("数学作业");
    expect(event?.note).not.toContain("明天 9:00 添加交作业");
  });

  it("缺少时间时创建全天事项", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "整理材料",
      startDate: "2026-07-10"
    }, "周五添加整理材料", "user-1");

    expect(event).toMatchObject({
      title: "整理材料",
      start_time: null,
      end_time: null,
      all_day: true
    });
  });

  it("按第一天创建短时间事项时阻止模型扩成多日范围", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "本科生预选",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
      startTime: "08:30",
      endTime: "08:30",
      recurrenceType: "daily"
    }, "不要每天都创建，第一天创建一个短时间事项就行", "user-1");

    expect(event).toMatchObject({
      start_date: "2026-07-20",
      end_date: "2026-07-20",
      start_time: "08:30",
      end_time: "09:00",
      recurrence_type: "none"
    });
  });

  it("明确创建习惯时写入 habit 类型", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      eventType: "habit",
      title: "背单词",
      startDate: "2026-07-09",
      endDate: "2026-07-31",
      recurrenceType: "daily",
      recurrenceUntil: "2026-07-31"
    }, "创建背单词习惯", "user-1");

    expect(event).toMatchObject({
      event_type: "habit",
      title: "背单词",
      start_date: "2026-07-09",
      end_date: "2026-07-09",
      recurrence_type: "daily",
      recurrence_until: "2026-07-31"
    });
  });

  it("拒绝无效日期", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "错误事项",
      startDate: "tomorrow"
    }, "明天添加错误事项", "user-1");

    expect(event).toBeNull();
  });

  it("允许补录过去事项并自动关闭已错过的提醒", () => {
    const records = recordsFromAiActions([{
      type: "create_event",
      title: "学生报到",
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      startTime: "17:00",
      endTime: "17:30",
      location: "第四教室楼 4104",
      note: "历史活动记录",
      reminderEnabled: true,
      reminderMinutesBefore: 30
    }], "补录 7 月 3 日学生报到", "user-1", new Date("2026-07-15T12:00:00+08:00"));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      table: "events",
      record: {
        start_date: "2026-07-03",
        end_date: "2026-07-03",
        start_time: "17:00",
        end_time: "17:30",
        location: "第四教室楼 4104",
        reminder_enabled: false
      }
    });
  });

  it("把 AI 返回的生日或纪念日转换为本地日子", () => {
    const anniversary = anniversaryFromAiAction({
      type: "create_anniversary",
      title: "妈妈生日",
      kind: "birthday",
      date: "2026-08-12",
      reminderEnabled: true,
      reminderDaysBefore: 3,
      reminderTime: "08:30"
    }, "创建妈妈生日", "user-1");

    expect(anniversary).toMatchObject({
      user_id: "user-1",
      kind: "birthday",
      title: "妈妈生日",
      date: "2026-08-12",
      reminder_enabled: true,
      reminder_days_before: 3,
      reminder_time: "08:30"
    });
  });

  it("把 AI 返回的备忘录转换为本地备忘录", () => {
    const memo = memoFromAiAction({
      type: "create_memo",
      title: "购物清单",
      content: "牛奶\n面包",
      isPinned: true
    }, "创建购物清单备忘录", "user-1");

    expect(memo).toMatchObject({
      user_id: "user-1",
      title: "购物清单",
      content: expect.stringContaining("牛奶"),
      is_pinned: true
    });
    expect(memo?.content).toBe("牛奶\n面包");
    expect(memo?.content).not.toContain("创建购物清单");
  });

  it("自动解析常见农历节日并创建节日", () => {
    const holiday = resolveHoliday("创建 2026 年端午节");
    expect(holiday).toEqual({
      title: "端午节",
      kind: "holiday",
      date: "2026-06-19"
    });

    const records = recordsFromAiActions([], "创建 2026 年春节", "user-1", new Date("2026-07-09T08:00:00+08:00"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      table: "anniversaries",
      record: {
        title: "春节",
        kind: "holiday",
        date: "2026-02-17"
      }
    });
  });

  it("一句话创建多个常见节日", () => {
    expect(resolveHolidays("创建 2026 年春节、端午节和清明节").map((item) => item.title)).toEqual([
      "清明节",
      "春节",
      "端午节"
    ]);

    const records = recordsFromAiActions([], "创建 2026 年春节、端午节", "user-1");
    expect(records.map((item) => item.record.title)).toEqual(["春节", "端午节"]);
  });

  it("支持省略节字的清明、除夕和按星期计算的节日", () => {
    expect(resolveHoliday("创建 2026 年清明")).toEqual({
      title: "清明节",
      kind: "holiday",
      date: "2026-04-05"
    });
    expect(resolveHoliday("创建 2026 年除夕")).toEqual({
      title: "除夕",
      kind: "holiday",
      date: "2026-02-16"
    });
    expect(resolveHolidays("创建 2026 年母亲节和父亲节").map((item) => `${item.title}:${item.date}`)).toEqual([
      "母亲节:2026-05-10",
      "父亲节:2026-06-21"
    ]);
  });

  it("模型把多个节日合成一个 action 时不重复创建已解析节日", () => {
    const records = recordsFromAiActions([{
      type: "create_anniversary",
      title: "春节、端午节和清明节",
      kind: "holiday",
      date: null
    }], "创建 2026 年春节、端午节和清明节", "user-1");

    expect(records.map((item) => item.record.title)).toEqual(["清明节", "春节", "端午节"]);
  });
});

describe("AI 助手修改和删除动作", () => {
  const baseEvent: EventItem = {
    id: "event-1",
    user_id: "user-1",
    event_type: "event",
    title: "设计与制造基础3课程设计",
    start_date: "2026-09-21",
    end_date: "2026-09-21",
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
    completed_at: null,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1"
  };

  it("按标题匹配已有事项，并可用日期进一步限定", () => {
    const other = { ...baseEvent, id: "event-2", start_date: "2026-09-23", end_date: "2026-09-23" };
    const different = { ...baseEvent, id: "event-3", title: "其他课程" };

    expect(matchEventsByTitle([baseEvent, other, different], "设计与制造基础3课程设计")).toHaveLength(2);
    expect(matchEventsByTitle([baseEvent, other, different], "设计与制造基础3课程设计", "2026-09-23").map((item) => item.id)).toEqual(["event-2"]);
    expect(matchEventsByTitle([baseEvent, other, different], "不存在的课程")).toHaveLength(0);
  });

  it("忽略已删除事项", () => {
    const removed = { ...baseEvent, id: "event-4", deleted_at: "2026-09-20T00:00:00.000Z" };
    expect(matchEventsByTitle([baseEvent, removed], "设计与制造基础3课程设计").map((item) => item.id)).toEqual(["event-1"]);
  });

  it("只修改用户指定的字段，其余保持不变", () => {
    const updated = applyEventUpdate(baseEvent, {
      type: "update_event",
      title: "设计与制造基础3课程设计",
      startTime: "10:00",
      endTime: "12:00",
      reminderMinutesBefore: 15
    });

    expect(updated).toMatchObject({
      title: "设计与制造基础3课程设计",
      start_date: "2026-09-21",
      start_time: "10:00",
      end_time: "12:00",
      reminder_minutes_before: 15,
      location: ""
    });
  });

  it("支持重命名并调整日期、地点和提醒", () => {
    const updated = applyEventUpdate(baseEvent, {
      type: "update_event",
      title: "设计与制造基础3课程设计",
      newTitle: "设计与制造课程设计",
      startDate: "2026-09-22",
      endDate: "2026-09-22",
      allDay: true,
      location: "工程训练中心",
      reminderEnabled: false
    });

    expect(updated).toMatchObject({
      title: "设计与制造课程设计",
      start_date: "2026-09-22",
      end_date: "2026-09-22",
      all_day: true,
      location: "工程训练中心",
      reminder_enabled: false
    });
    expect(updated.start_time).toBeNull();
    expect(updated.end_time).toBeNull();
  });

  it("模型未指定的 null 字段不会被当成清空", () => {
    const updated = applyEventUpdate(baseEvent, {
      type: "update_event",
      title: "设计与制造基础3课程设计",
      startTime: null,
      endTime: null,
      startDate: null,
      allDay: null,
      location: null,
      note: null,
      reminderMinutesBefore: null
    });

    expect(updated).toMatchObject({
      start_date: "2026-09-21",
      start_time: "08:00",
      end_time: "10:00",
      all_day: false,
      location: "",
      reminder_minutes_before: 10
    });
  });

  it("只改开始时间时为定时事项保持可用的结束时间", () => {
    const updated = applyEventUpdate(baseEvent, {
      type: "update_event",
      title: "设计与制造基础3课程设计",
      startTime: "11:00"
    });

    expect(updated).toMatchObject({ all_day: false, start_time: "11:00" });
    expect(updated.end_time && updated.end_time >= "11:00").toBe(true);
  });

  it("保持结束日期不早于开始日期", () => {
    const updated = applyEventUpdate(baseEvent, {
      type: "update_event",
      title: "设计与制造基础3课程设计",
      endDate: "2026-09-01"
    });

    expect(updated.start_date).toBe("2026-09-21");
    expect(updated.end_date).toBe("2026-09-21");
  });
});
