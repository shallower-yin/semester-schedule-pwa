import { describe, expect, it } from "vitest";
import { anniversaryFromAiAction, eventItemFromAiAction, memoFromAiAction, recordsFromAiActions, resolveHoliday, resolveHolidays } from "./aiEventActions";

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
    expect(event?.note).toContain("数学作业");
    expect(event?.note).toContain("由 AI 助手创建");
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
    expect(memo?.content).toContain("由 AI 助手创建");
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
