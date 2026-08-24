import { db, putRecordAndQueue } from "../db";
import type { HealthProfile } from "../types";
import { syncFields } from "./identity";
import { dueHealthReminderSlot } from "./healthReminderSchedule";
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
  reminder_end_time: "22:00",
  last_movement_reminder_at: null
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
  if (!profile?.movement_reminder_enabled) return false;
  const lastSent = readLastReminder(ownerId);
  const lastDeliveredAt = new Date(Math.max(
    profile.last_movement_reminder_at ? new Date(profile.last_movement_reminder_at).getTime() || 0 : 0,
    lastSent
  ));
  const reminderSlot = dueHealthReminderSlot(profile, lastDeliveredAt.getTime() ? lastDeliveredAt : null, now);
  if (!reminderSlot) return false;

  await showHealthMovementReminder();
  localStorage.setItem(`${LAST_REMINDER_KEY}:${ownerId}`, String(reminderSlot.getTime()));
  await recordHealthMovementReminderSent(ownerId, reminderSlot);
  return true;
}

export async function recordHealthMovementReminderSent(ownerId: string, at: Date): Promise<boolean> {
  const profile = await db.healthProfiles
    .filter((item) => item.user_id === ownerId && !item.deleted_at)
    .first();
  if (!profile) return false;
  const updated: HealthProfile = {
    ...profile,
    ...syncFields(profile),
    last_movement_reminder_at: at.toISOString()
  };
  await putRecordAndQueue("healthProfiles", updated);
  localStorage.setItem(`${LAST_REMINDER_KEY}:${ownerId}`, String(at.getTime()));
  return true;
}

function readLastReminder(ownerId: string): number {
  const value = Number(localStorage.getItem(`${LAST_REMINDER_KEY}:${ownerId}`));
  return Number.isFinite(value) ? value : 0;
}
