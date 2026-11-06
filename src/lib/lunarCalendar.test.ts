import { describe, expect, it } from "vitest";
import { dateAtProductTime, toISODate } from "./date";
import {
  gregorianDateForLunarDate, lunarDateParts, lunarOccurrenceDates, lunarOccurrenceForDate,
  lunarYearEndDate, lunarYearEndOccurrenceDates
} from "./lunarCalendar";

describe("确定性农历转换", () => {
  // Hong Kong Observatory's published calendar conversion tables:
  // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
  // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2027.pdf
  it.each([
    [2026, 1, 1, "2026-02-17"],
    [2026, 1, 15, "2026-03-03"],
    [2026, 5, 5, "2026-06-19"],
    [2026, 8, 15, "2026-09-25"],
    [2027, 1, 1, "2027-02-06"],
    [2027, 1, 15, "2027-02-20"],
    [2027, 8, 15, "2027-09-15"]
  ])("农历 %i-%i-%i 对应 %s", (year, month, day, expected) => {
    expect(gregorianDateForLunarDate(Number(year), Number(month), Number(day))).toBe(expected);
    expect(lunarDateParts(dateAtProductTime(String(expected), "12:00")))
      .toEqual({ relatedYear: year, month, day, isLeapMonth: false });
  });

  it("跨北京时间午夜时切换农历日，设备时区不影响结果", () => {
    expect(lunarDateParts(new Date("2027-02-05T15:59:59.999Z")))
      .toEqual({ relatedYear: 2026, month: 12, day: 29, isLeapMonth: false });
    expect(lunarDateParts(new Date("2027-02-05T16:00:00.000Z")))
      .toEqual({ relatedYear: 2027, month: 1, day: 1, isLeapMonth: false });
  });

  it("严格区分闰月与常月，拒绝不存在的闰月和小月三十", () => {
    expect(gregorianDateForLunarDate(2025, 6, 1)).toBe("2025-06-25");
    expect(gregorianDateForLunarDate(2025, 6, 1, true)).toBe("2025-07-25");
    expect(lunarDateParts(dateAtProductTime("2025-07-25", "12:00")))
      .toEqual({ relatedYear: 2025, month: 6, day: 1, isLeapMonth: true });
    expect(gregorianDateForLunarDate(2026, 6, 1, true)).toBeNull();
    expect(gregorianDateForLunarDate(2026, 12, 30)).toBeNull();
  });

  it.each([
    [1899, 1, 1], [2101, 1, 1], [2026, 0, 1], [2026, 13, 1],
    [2026, 1, 0], [2026, 1, 31], [2026.5, 1, 1], [2026, 1, 1.5]
  ])("越界或非整数农历 %i-%i-%i 不能转换", (year, month, day) => {
    expect(gregorianDateForLunarDate(year, month, day)).toBeNull();
  });

  it("普通日期每年按农历重算，缓存不固定为首年公历月日", () => {
    expect(lunarOccurrenceDates(2026, 8, 15, false, 2026, 2027))
      .toEqual(["2026-09-25", "2027-09-15"]);
    expect(toISODate(lunarOccurrenceForDate(2026, 8, 15, false, dateAtProductTime("2026-09-26", "12:00"))!))
      .toBe("2027-09-15");
  });

  it("除夕在大月三十、小月二十九都存在，而普通生日保留三十语义", () => {
    expect(lunarYearEndDate(2023)).toBe("2024-02-09");
    expect(lunarYearEndDate(2026)).toBe("2027-02-05");
    expect(lunarYearEndOccurrenceDates(2023, 2023, 2026))
      .toEqual(["2024-02-09", "2025-01-28", "2026-02-16", "2027-02-05"]);
    expect(lunarOccurrenceDates(2023, 12, 30, false, 2023, 2026)).toEqual(["2024-02-09"]);
  });
});
