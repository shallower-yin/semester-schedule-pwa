import type { EventItem } from "../types";

export function reminderTimeForOccurrence(event: EventItem, occurrenceDate: Date): Date {
  const startTime = event.start_time ?? "09:00";
  const [hours, minutes] = startTime.split(":").map(Number);
  const occurrenceStart = new Date(
    occurrenceDate.getFullYear(),
    occurrenceDate.getMonth(),
    occurrenceDate.getDate(),
    hours,
    minutes
  );
  return new Date(occurrenceStart.getTime() - (event.reminder_minutes_before ?? 0) * 60_000);
}

export function reminderIsDue(event: EventItem, occurrenceDate: Date, now: Date): boolean {
  const reminderTime = reminderTimeForOccurrence(event, occurrenceDate);
  const graceEnd = new Date(reminderTime.getTime() + 15 * 60_000);
  return now >= reminderTime && now <= graceEnd;
}
