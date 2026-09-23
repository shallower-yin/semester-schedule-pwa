import { parseLocalDate, toISODate } from "./date";

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

const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric"
});

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
  const parts = formatter.formatToParts(date);
  const monthText = parts.find((part) => part.type === "month")?.value ?? "正月";
  const monthAliases: Record<string, number> = { "十一月": 11, "十二月": 12, "闰十一月": 11, "闰十二月": 12 };
  const month = monthAliases[monthText]
    ?? (LUNAR_MONTHS.findIndex((label) => monthText === label || monthText === `闰${label}`) + 1);
  return {
    relatedYear: Number(parts.find((part) => String(part.type) === "relatedYear")?.value ?? 0),
    month: month || 1,
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
    isLeapMonth: monthText.startsWith("闰")
  };
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
  const start = Date.UTC(lunarYear, 0, 1, 12);
  const end = Date.UTC(lunarYear + 1, 2, 1, 12);
  let result: string | null = null;
  for (let time = start; time <= end; time += 86_400_000) {
    const parts = lunarDateParts(new Date(time));
    if (parts.relatedYear !== lunarYear || parts.month !== lunarMonth || parts.day !== lunarDay || parts.isLeapMonth !== isLeapMonth) continue;
    result = toISODate(new Date(time));
    break;
  }
  lunarDateCache.set(key, result);
  return result;
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
