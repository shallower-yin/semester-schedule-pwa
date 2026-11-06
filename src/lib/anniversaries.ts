import type { Anniversary, AnniversaryKind } from "../types";
import { addDays, dateAtProductTime, differenceInCalendarDays, formatMonthDay, parseLocalDate, toISODate } from "./date";
import { gregorianDateForLunarDate, lunarDateLabel, lunarDateParts, lunarOccurrenceForDate, lunarYearEndDate } from "./lunarCalendar";

type AnniversaryDateFields = Pick<Anniversary, "date" | "calendar_type" | "lunar_year" | "lunar_month" | "lunar_day" | "lunar_is_leap_month">
  & Partial<Pick<Anniversary, "kind" | "title">>;

export const ANNIVERSARY_KIND_META: Record<AnniversaryKind, { label: string; color: string }> = {
  anniversary: { label: "纪念日", color: "#d97706" },
  birthday: { label: "生日", color: "#db2777" },
  holiday: { label: "节日", color: "#059669" }
};

export const ANNIVERSARY_KINDS = Object.keys(ANNIVERSARY_KIND_META) as AnniversaryKind[];

export function anniversaryKindLabel(kind: AnniversaryKind): string {
  return ANNIVERSARY_KIND_META[kind]?.label ?? "纪念日";
}

export function occurrenceDateForYear(date: string, year: number): Date {
  const [, month, day] = date.split("-").map(Number);
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return parseLocalDate(`${year}-02-28`);
  }
  return parseLocalDate(`${year}-${pad2(month)}-${pad2(day)}`);
}

export function nextAnniversaryOccurrence(anniversary: AnniversaryDateFields, from = new Date()): Date {
  if (isLunarAnniversary(anniversary)) {
    if (isLunarYearEndAnniversary(anniversary)) {
      const today = toISODate(from);
      for (let year = Math.max(1900, anniversary.lunar_year!, Number(today.slice(0, 4)) - 1); year <= 2100; year += 1) {
        const date = lunarYearEndDate(year);
        if (date && date >= today) return parseLocalDate(date);
      }
      return parseLocalDate(anniversary.date);
    }
    return lunarOccurrenceForDate(
      anniversary.lunar_year!,
      anniversary.lunar_month!,
      anniversary.lunar_day!,
      Boolean(anniversary.lunar_is_leap_month),
      from
    ) ?? parseLocalDate(anniversary.date);
  }
  const original = parseLocalDate(anniversary.date);
  const today = parseLocalDate(toISODate(from));
  for (let year = today.getFullYear(); year <= today.getFullYear() + 4; year += 1) {
    const occurrence = occurrenceDateForYear(anniversary.date, year);
    if (occurrence < original) continue;
    if (occurrence >= today) return occurrence;
  }
  return occurrenceDateForYear(anniversary.date, today.getFullYear() + 5);
}

export function daysUntilAnniversary(anniversary: AnniversaryDateFields, from = new Date()): number {
  return differenceInCalendarDays(nextAnniversaryOccurrence(anniversary, from), from);
}

export function daysSinceAnniversary(anniversary: AnniversaryDateFields, from = new Date()): number {
  return differenceInCalendarDays(from, originalAnniversaryDate(anniversary));
}

export function anniversaryDistanceLabel(anniversary: AnniversaryDateFields & Pick<Anniversary, "kind">, from = new Date()): string {
  if (anniversary.kind === "anniversary") {
    const days = daysSinceAnniversary(anniversary, from);
    if (days === 0) return "今天";
    if (days > 0) return `${days} 天前`;
    return `${Math.abs(days)} 天后`;
  }
  const days = daysUntilAnniversary(anniversary, from);
  return days === 0 ? "今天" : `${days} 天后`;
}

export function yearsSinceAnniversary(anniversary: AnniversaryDateFields, occurrence: Date): number {
  if (isLunarAnniversary(anniversary)) {
    return Math.max(0, lunarDateParts(dateAtProductTime(toISODate(occurrence), "12:00")).relatedYear - anniversary.lunar_year!);
  }
  const originalYear = Number(anniversary.date.slice(0, 4));
  const occurrenceYear = Number(toISODate(occurrence).slice(0, 4));
  return Math.max(0, occurrenceYear - originalYear);
}

export function anniversaryReminderTimeForOccurrence(
  anniversary: Pick<Anniversary, "reminder_days_before" | "reminder_time">,
  occurrence: Date
): Date {
  const reminderDate = addDays(parseLocalDate(toISODate(occurrence)), -Math.max(0, anniversary.reminder_days_before ?? 0));
  return dateAtProductTime(toISODate(reminderDate), anniversary.reminder_time || "09:00");
}

export function anniversaryReminderIsDue(anniversary: Anniversary, occurrence: Date, now: Date): boolean {
  const reminderAt = anniversaryReminderTimeForOccurrence(anniversary, occurrence);
  const graceEnd = new Date(reminderAt);
  graceEnd.setMinutes(graceEnd.getMinutes() + 15);
  return now >= reminderAt && now <= graceEnd;
}

export function dueAnniversaryOccurrence(anniversary: Anniversary, now = new Date()): Date | null {
  if (!anniversary.reminder_enabled || anniversary.deleted_at) return null;
  if (isLunarAnniversary(anniversary)) {
    const currentYear = Number(toISODate(now).slice(0, 4));
    for (let lunarYear = Math.max(anniversary.lunar_year!, currentYear - 1); lunarYear <= currentYear + 2; lunarYear += 1) {
      const date = isLunarYearEndAnniversary(anniversary)
        ? lunarYearEndDate(lunarYear)
        : gregorianDateForLunarDate(
          lunarYear,
          anniversary.lunar_month!,
          anniversary.lunar_day!,
          Boolean(anniversary.lunar_is_leap_month)
        );
      const occurrence = date ? parseLocalDate(date) : null;
      if (occurrence && occurrence >= originalAnniversaryDate(anniversary) && anniversaryReminderIsDue(anniversary, occurrence, now)) return occurrence;
    }
    return null;
  }
  const original = parseLocalDate(anniversary.date);
  const startYear = Number(toISODate(now).slice(0, 4));
  for (let year = startYear; year <= startYear + 2; year += 1) {
    const occurrence = occurrenceDateForYear(anniversary.date, year);
    if (occurrence < original) continue;
    if (anniversaryReminderIsDue(anniversary, occurrence, now)) return occurrence;
  }
  return null;
}

export function anniversaryScheduleChanged(previous: Anniversary | undefined, next: Anniversary): boolean {
  if (!previous) return false;
  return previous.date !== next.date ||
    (previous.calendar_type ?? "solar") !== (next.calendar_type ?? "solar") ||
    previous.lunar_year !== next.lunar_year ||
    previous.lunar_month !== next.lunar_month ||
    previous.lunar_day !== next.lunar_day ||
    Boolean(previous.lunar_is_leap_month) !== Boolean(next.lunar_is_leap_month) ||
    isLunarYearEndAnniversary(previous) !== isLunarYearEndAnniversary(next) ||
    previous.reminder_enabled !== next.reminder_enabled ||
    previous.reminder_days_before !== next.reminder_days_before ||
    previous.reminder_time !== next.reminder_time ||
    previous.timezone !== next.timezone;
}

export function formatAnniversaryReminderLead(daysBefore: number): string {
  if (daysBefore === 0) return "当天";
  return `提前 ${daysBefore} 天`;
}

export function formatAnniversaryReminderBody(anniversary: Anniversary, occurrence: Date, from = new Date()): string {
  const days = differenceInCalendarDays(occurrence, from);
  const dayText = days === 0 ? "今天" : days === 1 ? "明天" : `${days} 天后`;
  const yearCount = yearsSinceAnniversary(anniversary, occurrence);
  const countText = yearCount > 0 && anniversary.kind !== "holiday" ? ` · 第 ${yearCount} 年` : "";
  return `${dayText} · ${anniversaryKindLabel(anniversary.kind)} · ${toISODate(occurrence).slice(0, 4)}年${formatMonthDay(occurrence)}${countText}`;
}

export function reminderPreviewText(anniversary: Anniversary, from = new Date()): string {
  const occurrence = nextAnniversaryOccurrence(anniversary, from);
  const reminderAt = anniversaryReminderTimeForOccurrence(anniversary, occurrence);
  return `${toISODate(reminderAt)} ${anniversary.reminder_time || "09:00"}`;
}

export function isLunarAnniversary(anniversary: AnniversaryDateFields): boolean {
  return anniversary.calendar_type === "lunar"
    && Number.isInteger(anniversary.lunar_year)
    && anniversary.lunar_year! >= 1900 && anniversary.lunar_year! <= 2100
    && Number.isInteger(anniversary.lunar_month)
    && anniversary.lunar_month! >= 1 && anniversary.lunar_month! <= 12
    && Number.isInteger(anniversary.lunar_day)
    && anniversary.lunar_day! >= 1 && anniversary.lunar_day! <= 30;
}

export function isLunarYearEndAnniversary(anniversary: { kind?: string; title?: string }): boolean {
  return anniversary.kind === "holiday" && /^(?:\d{4}年)?(?:除夕|大年三十)$/.test(anniversary.title?.replace(/\s+/g, "") ?? "");
}

export function anniversarySourceDateLabel(anniversary: AnniversaryDateFields): string {
  if (!isLunarAnniversary(anniversary)) {
    return anniversary.calendar_type === "lunar" ? "农历日期待确认" : anniversary.date;
  }
  return `农历 ${lunarDateLabel(
    anniversary.lunar_year!,
    anniversary.lunar_month!,
    anniversary.lunar_day!,
    Boolean(anniversary.lunar_is_leap_month)
  )}`;
}

function originalAnniversaryDate(anniversary: AnniversaryDateFields): Date {
  if (isLunarAnniversary(anniversary)) {
    const converted = isLunarYearEndAnniversary(anniversary)
      ? lunarYearEndDate(anniversary.lunar_year!)
      : gregorianDateForLunarDate(
        anniversary.lunar_year!, anniversary.lunar_month!, anniversary.lunar_day!, Boolean(anniversary.lunar_is_leap_month)
      );
    if (converted) return parseLocalDate(converted);
  }
  return parseLocalDate(anniversary.date);
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
