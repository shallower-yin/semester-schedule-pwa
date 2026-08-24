import type { HealthProfile } from "../types";
import { addDays, dateAtProductTime, parseLocalDate, toISODate } from "./date";

export const HEALTH_REMINDER_GRACE_MINUTES = 3;

export interface NativeHealthReminderPlan {
  triggerAt: Date;
  intervalMinutes: number;
  startMinutes: number;
  endMinutes: number;
}

export function computeNextHealthReminder(
  profile: HealthProfile,
  now = new Date()
): NativeHealthReminderPlan | null {
  if (!profile.movement_reminder_enabled || profile.deleted_at) return null;
  const intervalMinutes = Math.max(15, Math.min(240, profile.movement_interval_minutes));
  const startMinutes = timeMinutes(profile.reminder_start_time);
  const endMinutes = timeMinutes(profile.reminder_end_time);
  const candidate = reminderSlotsAround(now, intervalMinutes, startMinutes, endMinutes)
    .find((slot) => slot.getTime() > now.getTime());
  if (!candidate) return null;
  return {
    triggerAt: candidate,
    intervalMinutes,
    startMinutes,
    endMinutes
  };
}

export function dueHealthReminderSlot(
  profile: HealthProfile,
  lastDeliveredAt: Date | null,
  now = new Date(),
  graceMinutes = HEALTH_REMINDER_GRACE_MINUTES
): Date | null {
  if (!profile.movement_reminder_enabled || profile.deleted_at) return null;
  const intervalMinutes = Math.max(15, Math.min(240, profile.movement_interval_minutes));
  const startMinutes = timeMinutes(profile.reminder_start_time);
  const endMinutes = timeMinutes(profile.reminder_end_time);
  const slot = reminderSlotsAround(now, intervalMinutes, startMinutes, endMinutes)
    .filter((candidate) => candidate.getTime() <= now.getTime())
    .at(-1);
  if (!slot) return null;
  const delay = now.getTime() - slot.getTime();
  if (delay > Math.max(0, graceMinutes) * 60_000) return null;
  if (slot.getTime() < validTime(profile.updated_at)) return null;
  if (lastDeliveredAt && slot.getTime() <= lastDeliveredAt.getTime()) return null;
  return slot;
}

export function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0;
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0;
  return safeHour * 60 + safeMinute;
}

function reminderSlotsAround(reference: Date, intervalMinutes: number, startMinutes: number, endMinutes: number): Date[] {
  const referenceDate = parseLocalDate(toISODate(reference));
  const slots: Date[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const windowDate = addDays(referenceDate, dayOffset);
    const windowStart = dateAtProductTime(toISODate(windowDate), minuteTime(startMinutes));
    const endDate = startMinutes <= endMinutes ? windowDate : addDays(windowDate, 1);
    const windowEnd = dateAtProductTime(toISODate(endDate), minuteTime(endMinutes));
    for (let at = windowStart.getTime(); at <= windowEnd.getTime(); at += intervalMinutes * 60_000) {
      slots.push(new Date(at));
    }
  }
  return slots.sort((left, right) => left.getTime() - right.getTime());
}

function minuteTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function validTime(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
