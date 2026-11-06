import { describe, expect, it } from "vitest";
import { anniversaryFromAiAction, applyAnniversaryUpdate, applyEventUpdate, eventItemFromAiAction, matchEventsByTitle, memoFromAiAction, recordsFromAiActions, resolveHoliday, resolveHolidays } from "./aiEventActions";
import type { Anniversary, EventItem } from "../types";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";

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
    expect(holiday).toMatchObject({
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
    expect(resolveHoliday("创建 2026 年清明")).toMatchObject({
      title: "清明节",
      kind: "holiday",
      date: "2026-04-05"
    });
    expect(resolveHoliday("创建 2026 年除夕")).toMatchObject({
      title: "除夕",
      kind: "holiday",
      date: "2026-02-16",
      calendarType: "lunar",
      lunarYear: 2025,
      lunarMonth: 12,
      lunarDay: 29
    });
    expect(resolveHolidays("创建 2026 年母亲节和父亲节").map((item) => `${item.title}:${item.date}`)).toEqual([
      "母亲节:2026-05-10",
      "父亲节:2026-06-21"
    ]);
  });

  it.each([[1902, "1902-04-06"], [2027, "2027-04-05"], [2028, "2028-04-04"], [2029, "2029-04-04"], [2100, "2100-04-05"]])(
    "AI 创建 %i 年清明按确定性节气保存为 %s", (year, date) => {
      expect(resolveHoliday(`创建${year}年清明节`)).toMatchObject({ title: "清明节", date, calendarType: "solar" });
    }
  );

  it("模型把多个节日合成一个 action 时不重复创建已解析节日", () => {
    const records = recordsFromAiActions([{
      type: "create_anniversary",
      title: "春节、端午节和清明节",
      kind: "holiday",
      date: null
    }], "创建 2026 年春节、端午节和清明节", "user-1");

    expect(records.map((item) => item.record.title)).toEqual(["清明节", "春节", "端午节"]);
  });

  it("即使模型误把中秋写成公历 8 月 15 日，也按农历保存", () => {
    const records = recordsFromAiActions([{
      type: "create_anniversary",
      title: "中秋节",
      kind: "holiday",
      date: "2026-08-15"
    }], "创建中秋节", "user-1", new Date("2026-07-09T08:00:00+08:00"));

    expect(records[0].record).toMatchObject({
      title: "中秋节",
      calendar_type: "lunar",
      lunar_year: 2026,
      lunar_month: 8,
      lunar_day: 15,
      date: "2026-09-25"
    });
  });

  it("能从明确的农历数字日期创建日子", () => {
    const records = recordsFromAiActions([{
      type: "create_anniversary",
      title: "妈妈生日",
      kind: "birthday",
      calendarType: "lunar",
      lunarYear: 2026,
      lunarMonth: 8,
      lunarDay: 15
    }], "创建 2026 年农历 8 月 15 日妈妈生日", "user-1");
    expect(records[0]?.record).toMatchObject({
      calendar_type: "lunar",
      lunar_year: 2026,
      lunar_month: 8,
      lunar_day: 15,
      date: "2026-09-25"
    });
  });
});

describe("AI 农历日期回归", () => {
  const now = new Date("2026-11-07T03:20:00+08:00");

  it("六条生日分别保留原始农历年月日，不把原年月日当公历转换", () => {
    const cases = [
      { title: "甲生日", text: "1970年十月廿七", year: 1970, month: 10, day: 27, date: "1970-11-25" },
      { title: "乙生日", text: "2002年冬月初九", year: 2002, month: 11, day: 9, date: "2002-12-12" },
      { title: "丙生日", text: "2005.02.25", year: 2005, month: 2, day: 25, date: "2005-04-03" },
      { title: "丁生日", text: "1943年正月廿一", year: 1943, month: 1, day: 21, date: "1943-02-25" },
      { title: "戊生日", text: "1971年四月廿九", year: 1971, month: 4, day: 29, date: "1971-05-23" },
      { title: "己生日", text: "2005年九月初九", year: 2005, month: 9, day: 9, date: "2005-10-11" }
    ];
    const source = `添加生日：${cases.map(item => `${item.title}${item.text}`).join("，")}，都是农历`;
    const records = recordsFromAiActions(cases.map(item => ({
      type: "create_anniversary", kind: "birthday", title: item.title,
      calendarType: "solar", date: "2026-01-01"
    })), source, "user-1", now);
    expect(records).toHaveLength(6);
    cases.forEach((item, index) => expect(records[index].record).toMatchObject({
      title: item.title, date: item.date, calendar_type: "lunar",
      lunar_year: item.year, lunar_month: item.month, lunar_day: item.day,
      lunar_is_leap_month: false
    }));
  });

  it.each(["都是农历", "全是农历", "全部农历", "统一农历", "所有生日都是旧历", "全都按阴历", "一律农历"])("%s且模型标题无法绑定时要求确认，不能默默存公历或猜农历", (calendarText) => {
    const source = `创建甲生日1970年十月廿七，乙生日2002年冬月初九，${calendarText}`;
    const variants = [
      { calendarType: "solar", date: "2026-10-27" },
      { calendarType: null, date: "2026-10-27", lunarYear: null, lunarMonth: null, lunarDay: null },
      { calendarType: "lunar", lunarYear: 1970, lunarMonth: 10, lunarDay: 27 }
    ];
    variants.forEach(fields => expect(() => anniversaryFromAiAction({ type: "create_anniversary", kind: "birthday",
      title: "未识别的生日", ...fields } as DeepSeekAssistantAction, source, "user-1", now)).toThrow("请确认该日子的农历年月日"));
  });

  it("混合农历公历的多条日期无法对应标题时也停止猜测，能对应的公历记录正常保存", () => {
    const source = "创建甲生日农历1970年十月廿七，乙生日公历2002年12月12日";
    expect(() => anniversaryFromAiAction({ type: "create_anniversary", kind: "birthday", title: "未识别的生日",
      calendarType: "solar", date: "2002-12-12" }, source, "user-1", now)).toThrow("对应哪一个农历日期");
    expect(anniversaryFromAiAction({ type: "create_anniversary", kind: "birthday", title: "乙生日",
      calendarType: "solar", date: "2002-12-12" }, source, "user-1", now))
      .toMatchObject({ calendar_type: "solar", date: "2002-12-12", lunar_year: null });
  });

  it("全是农历时可绑定的两条日期仍按各自原始月日保存，公历节日沿用规则", () => {
    const source = "创建甲生日1970年十月廿七，乙生日2002年冬月初九，清明节和劳动节，全是农历";
    expect(anniversaryFromAiAction({ type: "create_anniversary", kind: "birthday", title: "乙生日", calendarType: "solar", date: "2002-12-02" }, source, "user-1", now))
      .toMatchObject({ calendar_type: "lunar", lunar_year: 2002, lunar_month: 11, lunar_day: 9, date: "2002-12-12" });
    expect(anniversaryFromAiAction({ type: "create_anniversary", kind: "holiday", title: "劳动节", calendarType: "lunar",
      lunarYear: 2026, lunarMonth: 5, lunarDay: 1 }, source, "user-1", now))
      .toMatchObject({ calendar_type: "solar", date: "2026-05-01", lunar_year: null });
  });

  it.each([
    ["十一月二十一", 11, 21, "2026-12-29"],
    ["十二月廿九", 12, 29, "2027-02-05"]
  ])("识别中文农历%s", (text, month, day, date) => {
    expect(anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "2026-01-01" },
      `创建甲生日，2026年农历${text}`, "user-1", now))
      .toMatchObject({ calendar_type: "lunar", lunar_month: month, lunar_day: day, date });
  });

  it("明确农历且日期不存在时阻止保存，不能退回模型的公历日期", () => {
    expect(() => anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "2026-06-01" },
      "创建2026年农历二月三十甲生日", "user-1", now)).toThrow("农历日期不存在");
    expect(() => anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "2026-06-01" },
      "创建2026年农历闰二月初一甲生日", "user-1", now)).toThrow("农历日期不存在");
  });

  it("混合节日统一创建时按节日本身的历法保存", () => {
    const records = recordsFromAiActions([], "创建2026年春节、端午、中秋、清明、劳动节，都用农历", "user-1", now);
    expect(records).toHaveLength(5);
    expect(records.find(item => item.record.title === "中秋节")?.record).toMatchObject({ calendar_type: "lunar", lunar_month: 8, lunar_day: 15, date: "2026-09-25" });
    expect(records.find(item => item.record.title === "清明节")?.record).toMatchObject({ calendar_type: "solar", date: "2026-04-05" });
    expect(records.find(item => item.record.title === "劳动节")?.record).toMatchObject({ calendar_type: "solar", date: "2026-05-01" });
    expect(anniversaryFromAiAction({ type: "create_anniversary", title: "劳动节", kind: "holiday", calendarType: "lunar",
      lunarYear: 2026, lunarMonth: 5, lunarDay: 1, date: "2026-05-02" }, "创建2026年劳动节", "user-1", now))
      .toMatchObject({ calendar_type: "solar", date: "2026-05-01", lunar_year: null });
  });

  it("模型给了互相冲突的公历年份时以明确农历年份为准", () => {
    expect(anniversaryFromAiAction({ type: "create_anniversary", title: "春节", kind: "holiday", calendarType: "lunar",
      lunarYear: 2027, lunarMonth: 1, lunarDay: 1, date: "2026-01-01" }, "创建春节", "user-1", now))
      .toMatchObject({ lunar_year: 2027, lunar_month: 1, lunar_day: 1, date: "2027-02-06" });
  });

  it("除夕每年取年末，不能因腊月没有三十而漏一年", () => {
    const record = anniversaryFromAiAction({ type: "create_anniversary", title: "除夕", kind: "holiday" }, "创建2027年除夕", "user-1", now);
    expect(record).toMatchObject({ date: "2027-02-05", lunar_year: 2026, lunar_month: 12, lunar_day: 29 });
    expect(record?.lunar_occurrence_dates).toContain("2028-01-25");
  });

  it("单次事项也按用户明确的农历日期校准，不接受模型的固定公历月日", () => {
    expect(eventItemFromAiAction({ type: "create_event", title: "提交材料", startDate: "2026-11-09", endDate: "2026-11-09" },
      "2026年农历十一月初九提交材料", "user-1", now))
      .toMatchObject({ start_date: "2026-12-17", end_date: "2026-12-17" });
    expect(() => eventItemFromAiAction({ type: "create_event", title: "提交材料", startDate: "2026-02-30" },
      "2026年农历二月三十提交材料", "user-1", now)).toThrow("农历日期不存在");
  });

  it("只修改农历月日也会重算公历日并清除旧提醒状态", () => {
    const original = anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday",
      calendarType: "lunar", lunarYear: 2026, lunarMonth: 1, lunarDay: 1 }, "创建甲生日", "user-1", now)!;
    original.reminder_sent_for = "2026-02-17";
    expect(applyAnniversaryUpdate(original, { type: "update_anniversary", title: "甲生日", lunarMonth: 11, lunarDay: 21 }))
      .toMatchObject({ calendar_type: "lunar", lunar_year: 2026, lunar_month: 11, lunar_day: 21, date: "2026-12-29", reminder_sent_for: null });
  });

  it("普通修改携带的null农历字段不会改变生日历法或日期", () => {
    const original = anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "2005-10-05" }, "创建甲生日", "user-1", now) as Anniversary;
    expect(applyAnniversaryUpdate(original, { type: "update_anniversary", title: "甲生日", lunarYear: null, lunarMonth: null,
      lunarDay: null, lunarIsLeapMonth: null, calendarType: null, reminderDaysBefore: 3 }))
      .toMatchObject({ calendar_type: "solar", date: "2005-10-05", lunar_year: null, lunar_month: null, lunar_day: null, reminder_days_before: 3 });
  });

  it("只有明确要求把公历换算成农历时才转换原日期", () => {
    expect(anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", calendarType: "lunar",
      lunarYear: 1971, lunarMonth: 5, lunarDay: 23 }, "把公历1971-05-23换算成农历，创建甲生日", "user-1", now))
      .toMatchObject({ date: "1971-05-23", lunar_year: 1971, lunar_month: 4, lunar_day: 29 });
    const original = anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "1971-05-23" }, "创建甲生日", "user-1", now)!;
    expect(applyAnniversaryUpdate(original, { type: "update_anniversary", title: "甲生日", calendarType: "lunar" },
      "把甲生日从公历转换成农历"))
      .toMatchObject({ date: "1971-05-23", lunar_year: 1971, lunar_month: 4, lunar_day: 29 });
    expect(anniversaryFromAiAction({ type: "create_anniversary", title: "甲生日", kind: "birthday", date: "1971-05-23" },
      "创建甲生日，原本农历1971年四月廿九被误写为公历，现在改成农历", "user-1", now))
      .toMatchObject({ date: "1971-05-23", lunar_year: 1971, lunar_month: 4, lunar_day: 29 });
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
