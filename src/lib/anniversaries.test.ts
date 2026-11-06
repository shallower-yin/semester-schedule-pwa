import { describe, expect, it } from "vitest";
import type { Anniversary } from "../types";
import {
  anniversaryDistanceLabel,
  anniversaryReminderTimeForOccurrence,
  anniversaryScheduleChanged,
  anniversarySourceDateLabel,
  daysSinceAnniversary,
  dueAnniversaryOccurrence,
  formatAnniversaryReminderLead,
  nextAnniversaryOccurrence,
  yearsSinceAnniversary
} from "./anniversaries";
import { gregorianDateForLunarDate, lunarDateParts, lunarYearEndDate, lunarYearEndOccurrenceDates } from "./lunarCalendar";
import { dateAtProductTime, parseLocalDate, productDateTimeParts, toISODate } from "./date";

describe("纪念日日期和提醒", () => {
  it("按提前天数和指定时间计算提醒触发点", () => {
    const reminderAt = anniversaryReminderTimeForOccurrence(
      { reminder_days_before: 2, reminder_time: "08:30" },
      parseLocalDate("2026-07-09")
    );

    expect(toISODate(reminderAt)).toBe("2026-07-07");
    expect(productDateTimeParts(reminderAt)).toMatchObject({ hour: 8, minute: 30 });
  });

  it("在提醒时间后的短窗口内判定为到期", () => {
    const anniversary = anniversaryRecord({
      date: "2020-07-09",
      reminder_days_before: 2,
      reminder_time: "08:30"
    });

    expect(toISODate(dueAnniversaryOccurrence(anniversary, dateAtProductTime("2026-07-07", "08:35"))!)).toBe("2026-07-09");
    expect(dueAnniversaryOccurrence(anniversary, dateAtProductTime("2026-07-07", "08:46"))).toBeNull();
  });

  it("支持当天提醒", () => {
    const anniversary = anniversaryRecord({
      date: "2020-07-07",
      reminder_days_before: 0,
      reminder_time: "09:00"
    });

    expect(toISODate(dueAnniversaryOccurrence(anniversary, dateAtProductTime("2026-07-07", "09:00"))!)).toBe("2026-07-07");
    expect(formatAnniversaryReminderLead(0)).toBe("当天");
  });

  it("2 月 29 日在非闰年按 2 月 28 日处理", () => {
    expect(toISODate(nextAnniversaryOccurrence({ date: "2020-02-29" }, dateAtProductTime("2027-02-27")))).toBe("2027-02-28");
    expect(toISODate(nextAnniversaryOccurrence({ date: "2020-02-29" }, dateAtProductTime("2027-03-01")))).toBe("2028-02-29");
  });

  it("纪念日显示已过去天数，生日和节日显示下次还有几天", () => {
    const now = dateAtProductTime("2026-07-08");

    expect(anniversaryDistanceLabel({ kind: "anniversary", date: "2026-03-27" }, now)).toBe("103 天前");
    expect(anniversaryDistanceLabel({ kind: "birthday", date: "2000-10-18" }, now)).toBe("102 天后");
    expect(anniversaryDistanceLabel({ kind: "holiday", date: "2026-01-01" }, now)).toBe("177 天后");
  });

  it("农历日按农历年换算，而不是固定公历月日", () => {
    expect(gregorianDateForLunarDate(2026, 8, 15)).toBe("2026-09-25");
    expect(gregorianDateForLunarDate(2027, 8, 15)).toBe("2027-09-15");
    expect(toISODate(nextAnniversaryOccurrence({
      date: "2026-09-25",
      calendar_type: "lunar",
      lunar_year: 2026,
      lunar_month: 8,
      lunar_day: 15,
      lunar_is_leap_month: false
    }, dateAtProductTime("2026-09-26")))).toBe("2027-09-15");
    expect(gregorianDateForLunarDate(2026, 12, 8)).toBe("2027-01-15");
  });

  it("与香港天文台2026和2027对照表一致，不受系统ICU版本影响", () => {
    // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
    // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2027.pdf
    expect(gregorianDateForLunarDate(2026, 1, 1)).toBe("2026-02-17");
    expect(gregorianDateForLunarDate(2027, 1, 1)).toBe("2027-02-06");
    expect(gregorianDateForLunarDate(2026, 1, 15)).toBe("2026-03-03");
    expect(gregorianDateForLunarDate(2027, 1, 15)).toBe("2027-02-20");
    expect(gregorianDateForLunarDate(2026, 5, 5)).toBe("2026-06-19");
    expect(lunarDateParts(dateAtProductTime("2027-02-06", "12:00")))
      .toEqual({ relatedYear: 2027, month: 1, day: 1, isLeapMonth: false });
  });

  it("除夕按每年农历年末计算，腊月只有二十九时仍有除夕和提醒", () => {
    expect(lunarYearEndDate(2023)).toBe("2024-02-09");
    expect(lunarYearEndDate(2024)).toBe("2025-01-28");
    expect(lunarYearEndOccurrenceDates(2023, 2023, 2026)).toEqual([
      "2024-02-09", "2025-01-28", "2026-02-16", "2027-02-05"
    ]);
    const anniversary = anniversaryRecord({
      kind: "holiday",
      title: "除夕",
      date: "2024-02-09",
      calendar_type: "lunar",
      lunar_year: 2023,
      lunar_month: 12,
      lunar_day: 30
    });
    expect(toISODate(nextAnniversaryOccurrence(anniversary, dateAtProductTime("2024-02-10")))).toBe("2025-01-28");
    expect(toISODate(dueAnniversaryOccurrence(anniversary, dateAtProductTime("2025-01-28", "09:00"))!)).toBe("2025-01-28");
  });

  it("普通农历生日保留指定日，不会把三十擅自改为二十九", () => {
    expect(gregorianDateForLunarDate(2024, 12, 30)).toBeNull();
    expect(toISODate(nextAnniversaryOccurrence({
      kind: "birthday", title: "生日", date: "2024-02-09", calendar_type: "lunar",
      lunar_year: 2023, lunar_month: 12, lunar_day: 30
    }, dateAtProductTime("2024-02-10")))).toBe("2030-02-02");
  });

  it("闰月与常月分别换算，无效闰月不能保存为其他月份", () => {
    expect(gregorianDateForLunarDate(2025, 6, 1)).toBe("2025-06-25");
    expect(gregorianDateForLunarDate(2025, 6, 1, true)).toBe("2025-07-25");
    expect(gregorianDateForLunarDate(2026, 6, 1, true)).toBeNull();
  });

  it("农历周年数使用发生日期的北京时间日期", () => {
    expect(yearsSinceAnniversary({
      date: "2026-02-17", calendar_type: "lunar", lunar_year: 2026, lunar_month: 1, lunar_day: 1
    }, parseLocalDate("2027-02-06"))).toBe(1);
  });

  it("农历字段与旧公历日期冲突时，计天和提醒以原始农历为准", () => {
    const anniversary = anniversaryRecord({
      date: "2026-10-27", calendar_type: "lunar", lunar_year: 2026, lunar_month: 8, lunar_day: 15
    });
    expect(daysSinceAnniversary(anniversary, dateAtProductTime("2026-09-26", "12:00"))).toBe(1);
    expect(toISODate(dueAnniversaryOccurrence(anniversary, dateAtProductTime("2026-09-25", "09:00"))!))
      .toBe("2026-09-25");
  });

  it("将固定农历日期改为除夕时更新提醒计划", () => {
    const birthday = anniversaryRecord({
      kind: "birthday", title: "生日", calendar_type: "lunar", lunar_year: 2023, lunar_month: 12, lunar_day: 30
    });
    expect(anniversaryScheduleChanged(birthday, { ...birthday, kind: "holiday", title: "除夕" })).toBe(true);
    expect(anniversaryScheduleChanged(birthday, { ...birthday, title: "改名生日" })).toBe(false);
  });

  it("缺失或越界的农历字段明确显示待确认，不伪装成公历原始日期", () => {
    expect(anniversarySourceDateLabel({ date: "2026-09-25", calendar_type: "lunar" })).toBe("农历日期待确认");
    expect(anniversarySourceDateLabel({
      date: "2026-09-25", calendar_type: "lunar", lunar_year: 2026, lunar_month: 13, lunar_day: 15
    })).toBe("农历日期待确认");
  });
});

function anniversaryRecord(overrides: Partial<Anniversary>): Anniversary {
  return {
    id: "anniversary-1",
    user_id: "local",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    kind: "anniversary",
    title: "测试纪念日",
    date: "2020-07-07",
    color: "#d97706",
    note: "",
    reminder_enabled: true,
    reminder_days_before: 0,
    reminder_time: "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}
