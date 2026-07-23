import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  FocusSession,
  Semester
} from "../types";
import { addDays, courseScheduleOccursOn, eventOccursOn, startOfWeek, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { totalFocusSeconds } from "./focus";

export interface ScheduleOverviewItem {
  id: string;
  type: "course" | "event";
  targetId: string;
  title: string;
  subtitle: string;
  timeLabel: string;
  sortTime: string;
  color: string;
  completed: boolean;
  occurrenceDate?: string;
  allDay?: boolean;
  endTime?: string | null;
}

export interface ScheduleOverview {
  todayDate: string;
  todayItemCount: number;
  todayCourseCount: number;
  todayEventCount: number;
  todayIncompleteEventCount: number;
  todayCompletedEventCount: number;
  weekEventCount: number;
  weekCompletedEventCount: number;
  weekCompletionRate: number;
  todayFocusSeconds: number;
  weekFocusSeconds: number;
  upcomingItems: ScheduleOverviewItem[];
  nextItem?: ScheduleOverviewItem | null;
  overdueIncompleteItems: ScheduleOverviewItem[];
  weekFocusTrend: ScheduleOverviewFocusTrendItem[];
}

export interface ScheduleOverviewFocusTrendItem {
  date: string;
  label: string;
  totalSeconds: number;
  sessionCount: number;
  isToday: boolean;
}

interface BuildScheduleOverviewInput {
  semester?: Semester | null;
  courses: Course[];
  schedules: CourseSchedule[];
  cancellations: CourseCancellation[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
  focusSessions: FocusSession[];
  maxItems?: number;
}

export function buildScheduleOverview(input: BuildScheduleOverviewInput, now = new Date()): ScheduleOverview {
  const todayDate = toISODate(now);
  const semester = input.semester;
  const courseMap = new Map(input.courses.filter((item) => !item.deleted_at).map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.filter((item) => !item.deleted_at).map((category) => [category.id, category]));

  const courseItems = semester ? input.schedules.flatMap((schedule) => {
    if (schedule.deleted_at || !courseScheduleOccursOn(schedule, semester, now)) return [];
    const course = courseMap.get(schedule.course_id);
    if (!course) return [];
    const canceled = input.cancellations.some(
      (item) => item.course_schedule_id === schedule.id && item.occurrence_date === todayDate && !item.deleted_at
    );
    if (canceled) return [];
    const startPeriod = input.periods.find(
      (period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period && !period.deleted_at
    );
    const endPeriod = input.periods.find(
      (period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period && !period.deleted_at
    );
    if (!startPeriod || !endPeriod) return [];
    return [{
      id: schedule.id,
      type: "course" as const,
      targetId: course.id,
      title: course.name,
      subtitle: [course.classroom, course.teacher].filter(Boolean).join(" · ") || "课程",
      timeLabel: `${startPeriod.start_time}–${endPeriod.end_time}`,
      sortTime: startPeriod.start_time,
      color: course.color,
      completed: false,
      allDay: false,
      endTime: endPeriod.end_time
    }];
  }) : [];

  const eventItems = input.events.flatMap((eventItem) => {
    if (eventItem.deleted_at || !eventOccursOn(eventItem, now)) return [];
    const completion = eventCompletionForDate(eventItem, input.occurrenceStates, now);
    const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
    const sortTime = eventItem.all_day ? "99:98" : eventItem.start_time ?? "99:99";
    return [{
      id: eventItem.id,
      type: "event" as const,
      targetId: eventItem.id,
      title: eventItem.title,
      subtitle: category?.name ?? "未分类事项",
      timeLabel: eventItem.all_day ? "全天" : formatTimeRange(eventItem.start_time, eventItem.end_time),
      sortTime,
      color: eventItem.color || category?.color || "#e36b32",
      completed: completion.completed,
      occurrenceDate: todayDate,
      allDay: eventItem.all_day,
      endTime: eventItem.end_time
    }];
  });

  const todayFocusSessions = input.focusSessions.filter((session) => !session.deleted_at && toISODate(new Date(session.ended_at)) === todayDate);
  const weekStart = startOfWeek(now);
  const nextWeekStart = addDays(weekStart, 7);
  const elapsedWeekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    .filter((date) => toISODate(date) <= todayDate);
  const weekEventOccurrences = elapsedWeekDates.flatMap((date) =>
    input.events.flatMap((eventItem) => {
      if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
      return [eventCompletionForDate(eventItem, input.occurrenceStates, date)];
    })
  );
  const weekFocusSessions = input.focusSessions.filter((session) => {
    if (session.deleted_at) return false;
    const endedAt = new Date(session.ended_at);
    return endedAt >= weekStart && endedAt < nextWeekStart;
  });
  const sortedItems = [...eventItems, ...courseItems].sort((left, right) => {
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    const timeCompare = left.sortTime.localeCompare(right.sortTime);
    if (timeCompare !== 0) return timeCompare;
    return left.title.localeCompare(right.title, "zh-Hans-CN");
  });
  const nextItem = selectNextOverviewItem(sortedItems, now);
  const todayCompletedEventCount = eventItems.filter((item) => item.completed).length;
  const weekCompletedEventCount = weekEventOccurrences.filter((item) => item.completed).length;
  const weekFocusTrend = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateText = toISODate(date);
    const sessions = input.focusSessions.filter((session) => !session.deleted_at && toISODate(new Date(session.ended_at)) === dateText);
    return {
      date: dateText,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      totalSeconds: totalFocusSeconds(sessions),
      sessionCount: sessions.length,
      isToday: dateText === todayDate
    };
  });

  return {
    todayDate,
    todayItemCount: sortedItems.length,
    todayCourseCount: courseItems.length,
    todayEventCount: eventItems.length,
    todayIncompleteEventCount: eventItems.length - todayCompletedEventCount,
    todayCompletedEventCount,
    weekEventCount: weekEventOccurrences.length,
    weekCompletedEventCount,
    weekCompletionRate: weekEventOccurrences.length ? Math.round((weekCompletedEventCount / weekEventOccurrences.length) * 100) : 0,
    todayFocusSeconds: totalFocusSeconds(todayFocusSessions),
    weekFocusSeconds: totalFocusSeconds(weekFocusSessions),
    upcomingItems: sortedItems.slice(0, input.maxItems ?? 5),
    nextItem,
    overdueIncompleteItems: buildOverdueIncompleteItems(input, now, categoryMap),
    weekFocusTrend
  };
}

export function selectNextOverviewItem(items: ScheduleOverviewItem[], now = new Date()): ScheduleOverviewItem | null {
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const incomplete = items.filter((item) => !item.completed);
  const timed = incomplete
    .filter((item) => !isAllDayOverviewItem(item) && overviewItemEndTime(item) >= currentTime)
    .sort((left, right) => left.sortTime.localeCompare(right.sortTime) || left.title.localeCompare(right.title, "zh-Hans-CN"));
  if (timed.length) return timed[0];
  return incomplete.find(isAllDayOverviewItem) ?? null;
}

function isAllDayOverviewItem(item: ScheduleOverviewItem): boolean {
  return item.allDay ?? item.timeLabel === "全天";
}

function overviewItemEndTime(item: ScheduleOverviewItem): string {
  if (item.endTime) return item.endTime;
  const matches = item.timeLabel.match(/\d{2}:\d{2}/g);
  return matches?.at(-1) ?? item.sortTime;
}

function buildOverdueIncompleteItems(
  input: BuildScheduleOverviewInput,
  now: Date,
  categoryMap: Map<string, Category>
): ScheduleOverviewItem[] {
  const result: ScheduleOverviewItem[] = [];
  const maxItems = input.maxItems ?? 5;
  for (let daysAgo = 1; daysAgo <= 30 && result.length < maxItems; daysAgo += 1) {
    const date = addDays(now, -daysAgo);
    const occurrenceDate = toISODate(date);
    for (const eventItem of input.events) {
      if (result.length >= maxItems) break;
      if (eventItem.deleted_at || eventItem.event_type === "habit" || !eventOccursOn(eventItem, date)) continue;
      const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
      if (completion.completed) continue;
      const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
      result.push({
        id: `${eventItem.id}-${occurrenceDate}`,
        type: "event",
        targetId: eventItem.id,
        title: eventItem.title,
        subtitle: category?.name ?? "未分类事项",
        timeLabel: `${date.getMonth() + 1}/${date.getDate()} ${eventItem.all_day ? "全天" : formatTimeRange(eventItem.start_time, eventItem.end_time)}`,
        sortTime: `${occurrenceDate} ${eventItem.all_day ? "00:00" : eventItem.start_time ?? "99:99"}`,
        color: eventItem.color || category?.color || "#e36b32",
        completed: false,
        occurrenceDate
      });
    }
  }
  return result;
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  if (end) return end;
  return "未设置时间";
}
