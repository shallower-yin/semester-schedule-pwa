import { db } from "../db";
import type { HealthProfile } from "../types";
import { isNativeApp } from "./nativeApp";
import { ensureNativeReminderPermission } from "./nativeReminders";
import { showHealthMovementReminder } from "./notifications";

export const DEFAULT_EXERCISE_ITEMS = ["俯卧撑", "仰卧起坐", "深蹲"];

export const DEFAULT_HEALTH_PROFILE = {
  height_cm: null,
  daily_water_goal_ml: 2000,
  exercise_items: [...DEFAULT_EXERCISE_ITEMS],
  movement_reminder_enabled: false,
  movement_interval_minutes: 60,
  reminder_start_time: "09:00",
  reminder_end_time: "22:00"
} as const;

const LAST_REMINDER_KEY = "semester-schedule-health-reminder";

export async function checkDueHealthReminder(ownerId: string, now = new Date()): Promise<boolean> {
  if (isNativeApp()) {
    // Android health reminders are persisted by AlarmManager and repeat from the native receiver.
    // Posting again from this page-lifecycle poll would create duplicates.
    await ensureNativeReminderPermission(false);
    return false;
  } else if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }
  const profile = await db.healthProfiles
    .filter((item) => item.user_id === ownerId && !item.deleted_at)
    .first();
  if (!profile?.movement_reminder_enabled || !withinReminderWindow(profile, now)) return false;

  const lastMovement = await db.healthLogs
    .filter((item) => item.user_id === ownerId && !item.deleted_at && item.kind === "movement")
    .reverse()
    .sortBy("logged_at")
    .then((items) => items[0]?.logged_at ?? null);
  const lastSent = readLastReminder(ownerId);
  const baseline = Math.max(
    new Date(profile.updated_at).getTime() || 0,
    lastMovement ? new Date(lastMovement).getTime() : 0,
    lastSent
  );
  if (now.getTime() - baseline < profile.movement_interval_minutes * 60_000) return false;

  await showHealthMovementReminder();
  localStorage.setItem(`${LAST_REMINDER_KEY}:${ownerId}`, String(now.getTime()));
  return true;
}

function withinReminderWindow(profile: HealthProfile, now: Date): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(profile.reminder_start_time);
  const end = minutes(profile.reminder_end_time);
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function readLastReminder(ownerId: string): number {
  const value = Number(localStorage.getItem(`${LAST_REMINDER_KEY}:${ownerId}`));
  return Number.isFinite(value) ? value : 0;
}
