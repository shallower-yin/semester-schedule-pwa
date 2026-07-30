import type { EventItem } from "../types";
import { toISODate } from "./date";

export function reminderTimeForOccurrence(event: EventItem, occurrenceDate: Date): Date {
  const startTime = event.start_time ?? "09:00";
  const normalizedTime = /^\d{2}:\d{2}$/.test(startTime) ? startTime : "09:00";
  const occurrenceStart = new Date(`${toISODate(occurrenceDate)}T${normalizedTime}:00+08:00`);
  return new Date(occurrenceStart.getTime() - (event.reminder_minutes_before ?? 0) * 60_000);
}

export function reminderIsDue(event: EventItem, occurrenceDate: Date, now: Date): boolean {
  const reminderTime = reminderTimeForOccurrence(event, occurrenceDate);
  const graceEnd = new Date(reminderTime.getTime() + 15 * 60_000);
  return now >= reminderTime && now <= graceEnd;
}
