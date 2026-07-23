import type { Anniversary, EventItem, EventOccurrenceState } from "../types";
import {
  anniversaryReminderTimeForOccurrence,
  formatAnniversaryReminderBody,
  nextAnniversaryOccurrence
} from "./anniversaries";
import { eventOccursOn, toISODate } from "./date";
import { reminderTimeForOccurrence } from "./reminderTime";

// Android can persist hundreds of one-shot alarms cheaply. A one-year rolling horizon avoids silently
// losing reminders when the APK is not reopened during a long vacation; the nearest 512 occurrences
// still provide a bounded reconciliation cost for unusually dense recurring calendars.
export const REMINDER_HORIZON_DAYS = 366;
export const MAX_SCHEDULED_REMINDERS = 512;

// One-off notifications (test / health) use fixed ids reserved above the hashed range so they never
// collide with a scheduled reminder.
export const TEST_NOTIFICATION_ID = 2_147_483_646;
export const HEALTH_NOTIFICATION_ID = 2_147_483_645;
const HASHED_ID_MODULO = 2_147_483_000;

export interface ScheduledReminder {
  key: string;
  id: number;
  title: string;
  body: string;
  at: Date;
}

export interface ComputeRemindersInput {
  events: EventItem[];
  anniversaries: Anniversary[];
  occurrenceStates: EventOccurrenceState[];
  now?: Date;
  horizonDays?: number;
  max?: number;
}

// Deterministic 31-bit positive id from a stable reminder key, so re-running the computation yields
// the same notification id and Android updates rather than duplicates. FNV-1a keeps collisions rare
// for the small working set; the caller still de-duplicates by id defensively.
export function reminderNotificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % HASHED_ID_MODULO) + 1;
}

function eventReminderActive(event: EventItem): boolean {
  return !event.deleted_at && event.reminder_enabled && !event.completed_at;
}

// Expands events (with recurrence) and anniversaries into the concrete future reminders due within the
// horizon, in device-local time, skipping past and completed occurrences. Sorted earliest-first and
// capped, so a device only ever holds the nearest reminders and later ones roll in as the window moves.
export function computeScheduledReminders(input: ComputeRemindersInput): ScheduledReminder[] {
  const now = input.now ?? new Date();
  const horizonDays = input.horizonDays ?? REMINDER_HORIZON_DAYS;
  const max = input.max ?? MAX_SCHEDULED_REMINDERS;
  const nowMs = now.getTime();
  const horizonEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + horizonDays,
    23,
    59,
    59,
    999
  ).getTime();

  const completedOccurrences = new Set<string>();
  for (const state of input.occurrenceStates) {
    if (!state.deleted_at && state.completed) {
      completedOccurrences.add(`${state.event_id}|${state.occurrence_date}`);
    }
  }

  const reminders: ScheduledReminder[] = [];

  for (const event of input.events) {
    if (!eventReminderActive(event)) continue;
    for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
      const occurrenceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
      if (!eventOccursOn(event, occurrenceDate)) continue;
      const at = reminderTimeForOccurrence(event, occurrenceDate);
      const atMs = at.getTime();
      if (atMs <= nowMs || atMs > horizonEnd) continue;
      const iso = toISODate(occurrenceDate);
      if (completedOccurrences.has(`${event.id}|${iso}`)) continue;
      const key = `event:${event.id}:${iso}`;
      const startTime = event.start_time ?? "09:00";
      reminders.push({
        key,
        id: reminderNotificationId(key),
        title: event.title || "日程提醒",
        body: event.all_day ? `${iso} 全天事项` : `${iso} ${startTime} 开始`,
        at
      });
    }
  }

  for (const anniversary of input.anniversaries) {
    if (anniversary.deleted_at || !anniversary.reminder_enabled) continue;
    const occurrence = nextAnniversaryOccurrence(anniversary, now);
    const at = anniversaryReminderTimeForOccurrence(anniversary, occurrence);
    const atMs = at.getTime();
    if (atMs <= nowMs || atMs > horizonEnd) continue;
    const iso = toISODate(occurrence);
    const key = `anniversary:${anniversary.id}:${iso}`;
    reminders.push({
      key,
      id: reminderNotificationId(key),
      title: anniversary.title || "纪念日提醒",
      body: formatAnniversaryReminderBody(anniversary, occurrence, at),
      at
    });
  }

  reminders.sort((left, right) => left.at.getTime() - right.at.getTime());

  const seenIds = new Set<number>();
  const unique: ScheduledReminder[] = [];
  for (const reminder of reminders) {
    if (seenIds.has(reminder.id)) continue;
    seenIds.add(reminder.id);
    unique.push(reminder);
    if (unique.length >= max) break;
  }
  return unique;
}
