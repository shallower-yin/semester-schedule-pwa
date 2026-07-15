import type { ClassPeriod, Course, CourseSchedule, EventItem, Semester } from "../types";
import { courseScheduleOccursOn, eventOccursOn, parseLocalDate, semesterWeekForDate, toISODate, weekdayOf } from "./date";

export interface ScheduleConflict {
  id: string;
  title: string;
  detail: string;
}

export function timeRangesOverlap(startA: string | null, endA: string | null, startB: string | null, endB: string | null): boolean {
  const aStart = minutes(startA ?? "00:00");
  const aEnd = minutes(endA ?? startA ?? "23:59");
  const bStart = minutes(startB ?? "00:00");
  const bEnd = minutes(endB ?? startB ?? "23:59");
  return aStart < bEnd && bStart < aEnd;
}

export function findEventConflicts(draft: EventItem, events: EventItem[]): ScheduleConflict[] {
  const from = parseLocalDate(draft.start_date);
  const to = parseLocalDate(draft.recurrence_type === "none" ? draft.end_date : draft.recurrence_until ?? draft.start_date);
  const result: ScheduleConflict[] = [];
  for (const eventItem of events) {
    if (eventItem.id === draft.id || eventItem.deleted_at) continue;
    let cursor = new Date(from);
    while (cursor <= to) {
      if (
        eventOccursOn(draft, cursor) &&
        eventOccursOn(eventItem, cursor) &&
        (draft.all_day || eventItem.all_day || timeRangesOverlap(draft.start_time, draft.end_time, eventItem.start_time, eventItem.end_time))
      ) {
        result.push({
          id: eventItem.id,
          title: eventItem.title,
          detail: `${cursor.getMonth() + 1}/${cursor.getDate()} ${eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`}`
        });
        break;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (result.length >= 5) break;
  }
  return result;
}

export function findCourseScheduleConflicts(
  courseId: string,
  courseName: string,
  schedules: CourseSchedule[],
  courses: Course[],
  draftSchedules: Array<{ id?: string; weekday: number; start_period: number; end_period: number; weeks: number[] }>
): ScheduleConflict[] {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const result: ScheduleConflict[] = [];
  for (const draft of draftSchedules) {
    for (const schedule of schedules) {
      if (schedule.deleted_at || schedule.course_id === courseId || schedule.id === draft.id) continue;
      if (schedule.weekday !== draft.weekday) continue;
      if (schedule.end_period < draft.start_period || draft.end_period < schedule.start_period) continue;
      const sharedWeeks = schedule.weeks.filter((week) => draft.weeks.includes(week));
      if (!sharedWeeks.length) continue;
      const course = courseMap.get(schedule.course_id);
      result.push({
        id: schedule.id,
        title: course?.name ?? courseName,
        detail: `周${draft.weekday} 第${Math.max(schedule.start_period, draft.start_period)}-${Math.min(schedule.end_period, draft.end_period)}节，第${sharedWeeks.slice(0, 5).join("、")}周`
      });
      if (result.length >= 5) return result;
    }
  }
  return result;
}

export function findEventCourseConflicts(
  draft: EventItem,
  semester: Semester,
  courses: Course[],
  schedules: CourseSchedule[],
  periods: ClassPeriod[]
): ScheduleConflict[] {
  const from = parseLocalDate(draft.start_date);
  const to = parseLocalDate(draft.recurrence_type === "none" ? draft.end_date : draft.recurrence_until ?? draft.start_date);
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const result: ScheduleConflict[] = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    if (eventOccursOn(draft, cursor)) {
      for (const schedule of schedules) {
        if (schedule.deleted_at || !courseScheduleOccursOn(schedule, semester, cursor)) continue;
        const startPeriod = periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period);
        const endPeriod = periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period);
        if (!startPeriod || !endPeriod) continue;
        if (draft.all_day || timeRangesOverlap(draft.start_time, draft.end_time, startPeriod.start_time, endPeriod.end_time)) {
          const course = courseMap.get(schedule.course_id);
          result.push({
            id: schedule.id,
            title: course?.name ?? "课程",
            detail: `${cursor.getMonth() + 1}/${cursor.getDate()} 第${schedule.start_period}-${schedule.end_period}节`
          });
          if (result.length >= 5) return result;
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function findCourseEventConflicts(
  semester: Semester,
  draftSchedules: Array<{ weekday: number; start_period: number; end_period: number; weeks: number[] }>,
  periods: ClassPeriod[],
  events: EventItem[]
): ScheduleConflict[] {
  const result: ScheduleConflict[] = [];
  for (const eventItem of events) {
    if (eventItem.deleted_at) continue;
    const from = parseLocalDate(eventItem.start_date);
    const to = parseLocalDate(eventItem.recurrence_type === "none" ? eventItem.end_date : eventItem.recurrence_until ?? eventItem.start_date);
    let cursor = new Date(from);
    while (cursor <= to) {
      if (eventOccursOn(eventItem, cursor)) {
        const dateConflict = findDraftCourseBlockForDate(semester, draftSchedules, periods, cursor);
        if (
          dateConflict &&
          (eventItem.all_day || timeRangesOverlap(eventItem.start_time, eventItem.end_time, dateConflict.start_time, dateConflict.end_time))
        ) {
          result.push({
            id: eventItem.id,
            title: eventItem.title,
            detail: `${toISODate(cursor)} ${eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`}`
          });
          break;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (result.length >= 5) break;
  }
  return result;
}

function findDraftCourseBlockForDate(
  semester: Semester,
  draftSchedules: Array<{ weekday: number; start_period: number; end_period: number; weeks: number[] }>,
  periods: ClassPeriod[],
  date: Date
): { start_time: string; end_time: string } | null {
  const week = semesterWeekForDate(semester, date);
  if (!week) return null;
  const weekday = weekdayOf(date);
  for (const draft of draftSchedules) {
    if (draft.weekday !== weekday || !draft.weeks.includes(week)) continue;
    const startPeriod = periods.find((period) => period.weekday === draft.weekday && period.period_number === draft.start_period);
    const endPeriod = periods.find((period) => period.weekday === draft.weekday && period.period_number === draft.end_period);
    if (startPeriod && endPeriod) return { start_time: startPeriod.start_time, end_time: endPeriod.end_time };
  }
  return null;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
