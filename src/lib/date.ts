import type { CourseSchedule, Semester, Weekday } from "../types";

const DAY_MS = 86_400_000;
export const PRODUCT_TIME_ZONE = "Asia/Shanghai";

export interface ProductDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toISODate(date: Date): string {
  // parseLocalDate creates explicit calendar cells at local midnight. Preserve
  // their Y-M-D; real instants are interpreted using the product timezone.
  if (
    date.getHours() === 0
    && date.getMinutes() === 0
    && date.getSeconds() === 0
    && date.getMilliseconds() === 0
  ) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** Calendar and clock fields for a real instant under the product timezone. */
export function productDateTimeParts(date: Date): ProductDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second"))
  };
}

/** Convert an Asia/Shanghai calendar date/time to its absolute instant. */
export function dateAtProductTime(date: string, time = "00:00"): Date {
  const normalizedTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time : "00:00";
  const withSeconds = normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime;
  return new Date(`${date}T${withSeconds}+08:00`);
}

export function addDays(date: Date, amount: number): Date {
  const [year, month, day] = isoParts(toISODate(date));
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return parseLocalDate(`${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`);
}

export function startOfWeek(date: Date): Date {
  const calendarDate = parseLocalDate(toISODate(date));
  return addDays(calendarDate, -(weekdayOf(calendarDate) - 1));
}

export function weekDates(anchor: Date): Date[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function differenceInCalendarDays(left: Date, right: Date): number {
  const [leftYear, leftMonth, leftDay] = isoParts(toISODate(left));
  const [rightYear, rightMonth, rightDay] = isoParts(toISODate(right));
  const leftUtc = Date.UTC(leftYear, leftMonth - 1, leftDay);
  const rightUtc = Date.UTC(rightYear, rightMonth - 1, rightDay);
  return Math.round((leftUtc - rightUtc) / DAY_MS);
}

export function semesterWeekForDate(semester: Semester, date: Date): number | null {
  const difference = differenceInCalendarDays(date, semesterWeekStart(semester));
  const week = Math.floor(difference / 7) + 1;
  return week >= 1 && week <= semester.total_weeks ? week : null;
}

export function semesterWeekStart(semester: Pick<Semester, "start_date">): Date {
  return startOfWeek(parseLocalDate(semester.start_date));
}

export function weekdayOf(date: Date): Weekday {
  const [year, month, day] = isoParts(toISODate(date));
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ((sundayBased + 6) % 7 + 1) as Weekday;
}

export function formatMonthDay(date: Date): string {
  const [, month, day] = isoParts(toISODate(date));
  return `${month}月${day}日`;
}

export function formatWeekRange(dates: Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const [firstYear, firstMonth, firstDay] = isoParts(toISODate(first));
  const [lastYear, lastMonth, lastDay] = isoParts(toISODate(last));
  if (firstYear !== lastYear) {
    return `${firstYear}年${formatMonthDay(first)} – ${lastYear}年${formatMonthDay(last)}`;
  }
  if (firstMonth === lastMonth) {
    return `${firstYear}年${firstMonth}月${firstDay}–${lastDay}日`;
  }
  return `${firstYear}年${formatMonthDay(first)} – ${formatMonthDay(last)}`;
}

export function dateIsToday(date: Date): boolean {
  return toISODate(date) === toISODate(new Date());
}

export function eventOccursOn(
  event: { start_date: string; end_date: string; recurrence_type: string; recurrence_until: string | null; recurrence_interval?: number },
  date: Date
): boolean {
  const target = toISODate(date);
  if (event.recurrence_type === "none") {
    return target >= event.start_date && target <= event.end_date;
  }
  if (target < event.start_date || (event.recurrence_until && target > event.recurrence_until)) {
    return false;
  }
  if (event.recurrence_type === "daily") return true;
  if (event.recurrence_type === "weekdays") {
    const weekday = weekdayOf(date);
    return weekday >= 1 && weekday <= 5;
  }
  if (event.recurrence_type === "weekly") return weekdayOf(date) === weekdayOf(parseLocalDate(event.start_date));
  if (event.recurrence_type === "monthly") {
    const [targetYear, targetMonth, targetDay] = isoParts(target);
    const [, , requestedDay] = isoParts(event.start_date);
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return targetDay === Math.min(requestedDay, lastDay);
  }
  if (event.recurrence_type === "interval") {
    const interval = Math.max(1, Number(event.recurrence_interval ?? 1));
    return differenceInCalendarDays(date, parseLocalDate(event.start_date)) % interval === 0;
  }
  return false;
}

export function courseScheduleOccursOn(schedule: CourseSchedule, semester: Semester, date: Date): boolean {
  if (schedule.deleted_at || schedule.weekday !== weekdayOf(date)) return false;
  if (toISODate(date) < semester.start_date) return false;
  const week = semesterWeekForDate(semester, date);
  return week !== null && schedule.weeks.includes(week);
}

function isoParts(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}
