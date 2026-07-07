import type { EventItem, EventOccurrenceState } from "../types";
import { addDays, differenceInCalendarDays, eventOccursOn, parseLocalDate, toISODate } from "./date";

export interface HabitStats {
  totalScheduled: number;
  completed: number;
  completionRate: number;
  currentStreak: number;
  todayOccurs: boolean;
  todayCompleted: boolean;
  todayDate: string;
}

export function isHabit(eventItem: EventItem): boolean {
  return eventItem.event_type === "habit";
}

export function eachHabitDate(habit: EventItem, from: Date, to: Date): string[] {
  const start = parseLocalDate(habit.start_date);
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const first = start > from ? start : new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const totalDays = differenceInCalendarDays(end, first);
  if (totalDays < 0) return [];
  return Array.from({ length: totalDays + 1 }, (_, index) => addDays(first, index))
    .filter((date) => eventOccursOn(habit, date))
    .map(toISODate);
}

export function buildHabitStats(habit: EventItem, occurrenceStates: EventOccurrenceState[], now = new Date()): HabitStats {
  const todayDate = toISODate(now);
  const rangeEnd = minDate(habitEndDate(habit), now);
  const scheduledDates = eachHabitDate(habit, parseLocalDate(habit.start_date), rangeEnd);
  const completedDates = new Set(
    occurrenceStates
      .filter((state) => state.event_id === habit.id && !state.deleted_at && state.completed)
      .map((state) => state.occurrence_date)
  );
  const completed = scheduledDates.filter((date) => completedDates.has(date)).length;
  const todayOccurs = eventOccursOn(habit, now);
  const todayCompleted = completedDates.has(todayDate);
  return {
    totalScheduled: scheduledDates.length,
    completed,
    completionRate: scheduledDates.length ? Math.round((completed / scheduledDates.length) * 100) : 0,
    currentStreak: currentHabitStreak(habit, completedDates, now),
    todayOccurs,
    todayCompleted,
    todayDate
  };
}

function currentHabitStreak(habit: EventItem, completedDates: Set<string>, now: Date): number {
  let streak = 0;
  let cursor = minDate(habitEndDate(habit), now);
  const start = parseLocalDate(habit.start_date);
  while (cursor >= start) {
    if (eventOccursOn(habit, cursor)) {
      const dateText = toISODate(cursor);
      if (!completedDates.has(dateText)) break;
      streak += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function habitEndDate(habit: EventItem): Date {
  return parseLocalDate(habit.recurrence_type !== "none" ? habit.recurrence_until ?? habit.end_date : habit.end_date);
}

function minDate(left: Date, right: Date): Date {
  return left < right ? left : right;
}
