import type { LocalNotificationSchema, PendingLocalNotificationSchema } from "@capacitor/local-notifications";
import { isNativeApp } from "./nativeApp";
import { HEALTH_NOTIFICATION_ID, TEST_NOTIFICATION_ID, type ScheduledReminder } from "./reminderSchedule";
import { withTimeout } from "./asyncTimeout";

// Native Android reminders. The browser keeps its Web Push / service-worker path; the APK WebView has
// no Notification API, so it schedules real Android local notifications through the OS AlarmManager
// (via @capacitor/local-notifications), which fire even when the app is closed. The plugin is imported
// lazily so it never enters the web bundle or the jsdom test environment.

const CHANNEL_ID = "reminders";
const RESERVED_IDS = new Set([TEST_NOTIFICATION_ID, HEALTH_NOTIFICATION_ID]);
// A native bridge call should return in milliseconds; anything longer is a stuck OEM implementation.
// Bounding every call keeps the account panel from freezing on "正在检查…" the way it once did.
const BRIDGE_TIMEOUT_MS = 8_000;
const PERMISSION_PROMPT_TIMEOUT_MS = 120_000;
let channelReady = false;

// Capacitor plugin objects are proxies that intercept every property access — including `then`.
// Returning the proxy straight from an async function makes the runtime treat it as a thenable and
// await `LocalNotifications.then()`, which is "not implemented on android" and never settles, freezing
// every reminder call. Wrapping it in a plain (non-thenable) object avoids the adoption entirely.
async function loadPlugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return { LocalNotifications };
}

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  try {
    const { LocalNotifications } = await loadPlugin();
    await withTimeout(
      LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: "日程提醒",
        description: "事项、纪念日与活动提醒",
        importance: 4,
        visibility: 1
      }),
      BRIDGE_TIMEOUT_MS,
      "创建通知渠道超时"
    );
  } catch {
    // Channels only exist on Android 8+; older devices deliver on the default channel.
  }
  channelReady = true;
}

// Returns whether notifications may be posted. When `request` is true the OS prompt is shown (used
// when the user explicitly turns a reminder on); otherwise it is a silent check. Channel creation is
// intentionally NOT on this path so a slow/stuck createChannel can never block a plain status read.
export async function ensureNativeReminderPermission(request: boolean): Promise<"granted" | "denied"> {
  if (!isNativeApp()) return "denied";
  try {
    const { LocalNotifications } = await withTimeout(loadPlugin(), BRIDGE_TIMEOUT_MS, "加载通知插件超时");
    let status = await withTimeout(LocalNotifications.checkPermissions(), BRIDGE_TIMEOUT_MS, "读取通知权限超时");
    if (status.display !== "granted" && request) {
      status = await withTimeout(LocalNotifications.requestPermissions(), PERMISSION_PROMPT_TIMEOUT_MS, "通知授权超时");
    }
    return status.display === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

function signatureOf(reminder: ScheduledReminder): string {
  return `${reminder.title}${reminder.body}${reminder.at.getTime()}`;
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
  try {
    const { LocalNotifications } = await loadPlugin();
    const pending = (await withTimeout(LocalNotifications.getPending(), BRIDGE_TIMEOUT_MS, "读取待发提醒超时")).notifications;
    const pendingById = new Map(pending.map((item) => [item.id, item]));
    const desiredIds = new Set(reminders.map((reminder) => reminder.id));

    const toCancel = pending
      .filter((item) => !RESERVED_IDS.has(item.id) && !desiredIds.has(item.id))
      .map((item) => ({ id: item.id }));
    if (toCancel.length) await withTimeout(LocalNotifications.cancel({ notifications: toCancel }), BRIDGE_TIMEOUT_MS, "取消提醒超时");

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
      await withTimeout(LocalNotifications.schedule({ notifications: toSchedule }), BRIDGE_TIMEOUT_MS, "安排提醒超时");
    }
    return reminders.length;
  } catch {
    return 0;
  }
}

export async function cancelAllNativeReminders(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await loadPlugin();
    const pending = (await withTimeout(LocalNotifications.getPending(), BRIDGE_TIMEOUT_MS, "读取待发提醒超时")).notifications
      .filter((item) => !RESERVED_IDS.has(item.id))
      .map((item) => ({ id: item.id }));
    if (pending.length) await withTimeout(LocalNotifications.cancel({ notifications: pending }), BRIDGE_TIMEOUT_MS, "取消提醒超时");
  } catch {
    // Nothing scheduled or plugin unavailable.
  }
}

// Delivers a notification immediately (test button / health movement reminder).
export async function showNativeNotificationNow(options: { id: number; title: string; body: string }): Promise<boolean> {
  if ((await ensureNativeReminderPermission(false)) !== "granted") return false;
  try {
    const { LocalNotifications } = await loadPlugin();
    await ensureChannel();
    await withTimeout(
      LocalNotifications.schedule({
        notifications: [{ id: options.id, title: options.title, body: options.body, channelId: CHANNEL_ID }]
      }),
      BRIDGE_TIMEOUT_MS,
      "发送通知超时"
    );
    return true;
  } catch {
    return false;
  }
}
