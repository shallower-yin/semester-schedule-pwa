import type { CourseSchedule, Semester, Weekday } from "../types";

const DAY_MS = 86_400_000;

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function weekDates(anchor: Date): Date[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function differenceInCalendarDays(left: Date, right: Date): number {
  const leftUtc = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const rightUtc = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((leftUtc - rightUtc) / DAY_MS);
}

export function semesterWeekForDate(semester: Semester, date: Date): number | null {
  const start = parseLocalDate(semester.start_date);
  const difference = differenceInCalendarDays(date, start);
  const week = Math.floor(difference / 7) + 1;
  return week >= 1 && week <= semester.total_weeks ? week : null;
}

export function weekdayOf(date: Date): Weekday {
  return ((date.getDay() + 6) % 7 + 1) as Weekday;
}

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatWeekRange(dates: Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first.getFullYear() !== last.getFullYear()) {
    return `${first.getFullYear()}年${formatMonthDay(first)} – ${last.getFullYear()}年${formatMonthDay(last)}`;
  }
  if (first.getMonth() === last.getMonth()) {
    return `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}–${last.getDate()}日`;
  }
  return `${first.getFullYear()}年${formatMonthDay(first)} – ${formatMonthDay(last)}`;
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
    return date.getDate() === parseLocalDate(event.start_date).getDate();
  }
  if (event.recurrence_type === "interval") {
    const interval = Math.max(1, Number(event.recurrence_interval ?? 1));
    return differenceInCalendarDays(date, parseLocalDate(event.start_date)) % interval === 0;
  }
  return false;
}

export function courseScheduleOccursOn(schedule: CourseSchedule, semester: Semester, date: Date): boolean {
  if (schedule.deleted_at || schedule.weekday !== weekdayOf(date)) return false;
  const week = semesterWeekForDate(semester, date);
  return week !== null && schedule.weeks.includes(week);
}
