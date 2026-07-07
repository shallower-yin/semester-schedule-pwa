import type { Anniversary, AnniversaryKind } from "../types";
import { addDays, differenceInCalendarDays, formatMonthDay, parseLocalDate, toISODate } from "./date";

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
  const original = parseLocalDate(date);
  const month = original.getMonth();
  const day = original.getDate();
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    return new Date(year, 1, 28);
  }
  return new Date(year, month, day);
}

export function nextAnniversaryOccurrence(anniversary: Pick<Anniversary, "date">, from = new Date()): Date {
  const original = parseLocalDate(anniversary.date);
  const today = startOfLocalDay(from);
  for (let year = today.getFullYear(); year <= today.getFullYear() + 4; year += 1) {
    const occurrence = occurrenceDateForYear(anniversary.date, year);
    if (occurrence < startOfLocalDay(original)) continue;
    if (occurrence >= today) return occurrence;
  }
  return occurrenceDateForYear(anniversary.date, today.getFullYear() + 5);
}

export function daysUntilAnniversary(anniversary: Pick<Anniversary, "date">, from = new Date()): number {
  return differenceInCalendarDays(nextAnniversaryOccurrence(anniversary, from), from);
}

export function yearsSinceAnniversary(anniversary: Pick<Anniversary, "date">, occurrence: Date): number {
  const original = parseLocalDate(anniversary.date);
  return Math.max(0, occurrence.getFullYear() - original.getFullYear());
}

export function anniversaryReminderTimeForOccurrence(
  anniversary: Pick<Anniversary, "reminder_days_before" | "reminder_time">,
  occurrence: Date
): Date {
  const reminderDate = addDays(startOfLocalDay(occurrence), -Math.max(0, anniversary.reminder_days_before ?? 0));
  const [hours, minutes] = (anniversary.reminder_time || "09:00").split(":").map(Number);
  reminderDate.setHours(hours || 0, minutes || 0, 0, 0);
  return reminderDate;
}

export function anniversaryReminderIsDue(anniversary: Anniversary, occurrence: Date, now: Date): boolean {
  const reminderAt = anniversaryReminderTimeForOccurrence(anniversary, occurrence);
  const graceEnd = new Date(reminderAt);
  graceEnd.setMinutes(graceEnd.getMinutes() + 15);
  return now >= reminderAt && now <= graceEnd;
}

export function dueAnniversaryOccurrence(anniversary: Anniversary, now = new Date()): Date | null {
  if (!anniversary.reminder_enabled || anniversary.deleted_at) return null;
  const original = startOfLocalDay(parseLocalDate(anniversary.date));
  const startYear = now.getFullYear();
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
  return `${dayText} · ${anniversaryKindLabel(anniversary.kind)} · ${occurrence.getFullYear()}年${formatMonthDay(occurrence)}${countText}`;
}

export function reminderPreviewText(anniversary: Anniversary, from = new Date()): string {
  const occurrence = nextAnniversaryOccurrence(anniversary, from);
  const reminderAt = anniversaryReminderTimeForOccurrence(anniversary, occurrence);
  const time = `${String(reminderAt.getHours()).padStart(2, "0")}:${String(reminderAt.getMinutes()).padStart(2, "0")}`;
  return `${toISODate(reminderAt)} ${time}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}
