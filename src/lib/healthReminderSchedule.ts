import type { HealthProfile } from "../types";
import { addDays, dateAtProductTime, parseLocalDate, productDateTimeParts, toISODate } from "./date";

export interface NativeHealthReminderPlan {
  triggerAt: Date;
  intervalMinutes: number;
  startMinutes: number;
  endMinutes: number;
}

export function computeNextHealthReminder(
  profile: HealthProfile,
  lastMovementAt: string | null,
  now = new Date()
): NativeHealthReminderPlan | null {
  if (!profile.movement_reminder_enabled || profile.deleted_at) return null;
  const intervalMinutes = Math.max(15, Math.min(240, profile.movement_interval_minutes));
  const startMinutes = timeMinutes(profile.reminder_start_time);
  const endMinutes = timeMinutes(profile.reminder_end_time);
  const baseline = Math.max(
    validTime(profile.updated_at),
    validTime(lastMovementAt),
    validTime(profile.last_movement_reminder_at),
    now.getTime() - intervalMinutes * 60_000
  );
  const candidate = new Date(Math.max(now.getTime() + 5_000, baseline + intervalMinutes * 60_000));
  return {
    triggerAt: moveIntoWindow(candidate, startMinutes, endMinutes),
    intervalMinutes,
    startMinutes,
    endMinutes
  };
}

export function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0;
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0;
  return safeHour * 60 + safeMinute;
}

function moveIntoWindow(candidate: Date, startMinutes: number, endMinutes: number): Date {
  const productCandidate = productDateTimeParts(candidate);
  const minute = productCandidate.hour * 60 + productCandidate.minute;
  const inside = startMinutes <= endMinutes
    ? minute >= startMinutes && minute <= endMinutes
    : minute >= startMinutes || minute <= endMinutes;
  if (inside) return candidate;

  const candidateDate = parseLocalDate(toISODate(candidate));
  const targetDate = startMinutes <= endMinutes && minute > endMinutes
    ? addDays(candidateDate, 1)
    : candidateDate;
  const time = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
  return dateAtProductTime(toISODate(targetDate), time);
}

function validTime(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
