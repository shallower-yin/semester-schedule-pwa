import type { LocalNotificationSchema, PendingLocalNotificationSchema } from "@capacitor/local-notifications";
import { isNativeApp } from "./nativeApp";
import { HEALTH_NOTIFICATION_ID, TEST_NOTIFICATION_ID, type ScheduledReminder } from "./reminderSchedule";

// Native Android reminders. The browser keeps its Web Push / service-worker path; the APK WebView has
// no Notification API, so it schedules real Android local notifications through the OS AlarmManager
// (via @capacitor/local-notifications), which fire even when the app is closed. The plugin is imported
// lazily so it never enters the web bundle or the jsdom test environment.

const CHANNEL_ID = "reminders";
const RESERVED_IDS = new Set([TEST_NOTIFICATION_ID, HEALTH_NOTIFICATION_ID]);
let channelReady = false;

async function plugin() {
  const module = await import("@capacitor/local-notifications");
  return module.LocalNotifications;
}

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  try {
    const notifications = await plugin();
    await notifications.createChannel({
      id: CHANNEL_ID,
      name: "日程提醒",
      description: "事项、纪念日与活动提醒",
      importance: 4,
      visibility: 1
    });
  } catch {
    // Channels only exist on Android 8+; older devices deliver on the default channel.
  }
  channelReady = true;
}

// Returns whether notifications may be posted. When `request` is true the OS prompt is shown (used
// when the user explicitly turns a reminder on); otherwise it is a silent check.
export async function ensureNativeReminderPermission(request: boolean): Promise<"granted" | "denied"> {
  if (!isNativeApp()) return "denied";
  try {
    const notifications = await plugin();
    let status = await notifications.checkPermissions();
    if (status.display !== "granted" && request) {
      status = await notifications.requestPermissions();
    }
    if (status.display !== "granted") return "denied";
    await ensureChannel();
    return "granted";
  } catch {
    return "denied";
  }
}

function signatureOf(reminder: ScheduledReminder): string {
  return `${reminder.title}${reminder.body}${reminder.at.getTime()}`;
}

function pendingSignature(pending: PendingLocalNotificationSchema): string {
  const extra = pending.extra as { sig?: string } | null | undefined;
  return extra?.sig ?? "";
}

// Reconciles the OS's pending notifications with the desired set: cancels reminders that no longer
// apply, (re)schedules new or edited ones, and leaves unchanged ones untouched so there is no churn
// on the periodic sync. Reserved one-off ids (test/health) are never touched. Returns the desired count.
export async function syncNativeReminders(reminders: ScheduledReminder[]): Promise<number> {
  if (!isNativeApp()) return 0;
  if ((await ensureNativeReminderPermission(false)) !== "granted") return 0;
  const notifications = await plugin();
  const pending = (await notifications.getPending()).notifications;
  const pendingById = new Map(pending.map((item) => [item.id, item]));
  const desiredIds = new Set(reminders.map((reminder) => reminder.id));

  const toCancel = pending
    .filter((item) => !RESERVED_IDS.has(item.id) && !desiredIds.has(item.id))
    .map((item) => ({ id: item.id }));
  if (toCancel.length) await notifications.cancel({ notifications: toCancel });

  const toSchedule: LocalNotificationSchema[] = reminders
    .filter((reminder) => {
      const existing = pendingById.get(reminder.id);
      return !existing || pendingSignature(existing) !== signatureOf(reminder);
    })
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      body: reminder.body,
      channelId: CHANNEL_ID,
      schedule: { at: reminder.at, allowWhileIdle: true },
      extra: { sig: signatureOf(reminder), key: reminder.key }
    }));
  if (toSchedule.length) {
    await ensureChannel();
    await notifications.schedule({ notifications: toSchedule });
  }
  return reminders.length;
}

export async function cancelAllNativeReminders(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const notifications = await plugin();
    const pending = (await notifications.getPending()).notifications
      .filter((item) => !RESERVED_IDS.has(item.id))
      .map((item) => ({ id: item.id }));
    if (pending.length) await notifications.cancel({ notifications: pending });
  } catch {
    // Nothing scheduled or plugin unavailable.
  }
}

// Delivers a notification immediately (test button / health movement reminder).
export async function showNativeNotificationNow(options: { id: number; title: string; body: string }): Promise<boolean> {
  if ((await ensureNativeReminderPermission(false)) !== "granted") return false;
  try {
    const notifications = await plugin();
    await notifications.schedule({
      notifications: [{ id: options.id, title: options.title, body: options.body, channelId: CHANNEL_ID }]
    });
    return true;
  } catch {
    return false;
  }
}
