import { Lunar, Solar } from "lunar-typescript";
import { parseLocalDate, productDateTimeParts, toISODate } from "./date";

export const LUNAR_MONTHS = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "冬月", "腊月"
] as const;

export interface LunarDateParts {
  relatedYear: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
}

const lunarDateCache = new Map<string, string | null>();

export function lunarMonthLabel(month: number): string {
  return LUNAR_MONTHS[month - 1] ?? `${month}月`;
}

export function lunarDayLabel(day: number): string {
  if (day <= 10) return `初${day === 10 ? "十" : numberLabel(day)}`;
  if (day < 20) return `十${numberLabel(day - 10)}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${numberLabel(day - 20)}`;
  return "三十";
}

export function lunarDateLabel(year: number, month: number, day: number, isLeapMonth = false): string {
  return `${year}年${isLeapMonth ? "闰" : ""}${lunarMonthLabel(month)}${lunarDayLabel(day)}`;
}

export function lunarDateParts(date: Date): LunarDateParts {
  const parts = productDateTimeParts(date);
  const lunar = Solar.fromYmd(parts.year, parts.month, parts.day).getLunar();
  return {
    relatedYear: lunar.getYear(),
    month: Math.abs(lunar.getMonth()),
    day: lunar.getDay(),
    isLeapMonth: lunar.getMonth() < 0
  };
}

/** 清明 follows the solar term, so its Gregorian day must be recomputed each year. */
export function qingmingDateForYear(year: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  return Solar.fromYmd(year, 4, 5).getLunar().getJieQiTable()["清明"].toYmd();
}

/** Convert a lunar date in a specific lunar year to a Beijing calendar date. */
export function gregorianDateForLunarDate(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth = false
): string | null {
  const key = `${lunarYear}-${lunarMonth}-${lunarDay}-${isLeapMonth ? 1 : 0}`;
  const cached = lunarDateCache.get(key);
  if (cached !== undefined) return cached;
  if (!Number.isInteger(lunarYear) || lunarYear < 1900 || lunarYear > 2100) return null;
  if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) return null;
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) return null;
  let result: string | null = null;
  try {
    // Keep one deterministic calendar on browsers, Android and the server.
    // ICU's Chinese calendar can differ across versions (e.g. 2027-02-06).
    result = Lunar.fromYmd(lunarYear, isLeapMonth ? -lunarMonth : lunarMonth, lunarDay).getSolar().toYmd();
  } catch {
    // Missing leap months and the 30th day of a short month are invalid dates.
  }
  lunarDateCache.set(key, result);
  return result;
}

/** 除夕 is the final day of the lunar year, including years with only 29 days in 腊月. */
export function lunarYearEndDate(lunarYear: number): string | null {
  return gregorianDateForLunarDate(lunarYear, 12, 30)
    ?? gregorianDateForLunarDate(lunarYear, 12, 29);
}

export function lunarYearEndOccurrenceDates(lunarYear: number, fromYear = 1900, toYear = 2100): string[] {
  const dates: string[] = [];
  for (let year = Math.max(1900, lunarYear, fromYear); year <= Math.min(2100, toYear); year += 1) {
    const date = lunarYearEndDate(year);
    if (date) dates.push(date);
  }
  return dates;
}

export function lunarOccurrenceDates(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth = false,
  fromYear = 1900,
  toYear = 2100
): string[] {
  const dates: string[] = [];
  for (let year = Math.max(1900, lunarYear, fromYear); year <= Math.min(2100, toYear); year += 1) {
    const date = gregorianDateForLunarDate(year, lunarMonth, lunarDay, isLeapMonth);
    if (date) dates.push(date);
  }
  return dates;
}

export function lunarOccurrenceForDate(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth: boolean,
  from: Date
): Date | null {
  const today = parseLocalDate(toISODate(from));
  const firstYear = Math.max(1900, lunarYear, today.getFullYear() - 1);
  for (let year = firstYear; year <= 2100; year += 1) {
    const value = gregorianDateForLunarDate(year, lunarMonth, lunarDay, isLeapMonth);
    if (!value) continue;
    const date = parseLocalDate(value);
    if (date >= today) return date;
  }
  return null;
}

function numberLabel(value: number): string {
  return ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][value] ?? String(value);
}
