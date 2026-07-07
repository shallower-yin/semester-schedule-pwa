import { db, queueChange } from "../db";
import { dueAnniversaryOccurrence, formatAnniversaryReminderBody } from "./anniversaries";
import { eventOccursOn, toISODate } from "./date";
import { getCurrentUserId, getDeviceId, syncFields } from "./identity";
import { reminderIsDue } from "./reminderTime";
import { supabase } from "./supabase";
import type { Anniversary, EventItem } from "../types";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();

export type NotificationStatus =
  | "unsupported"
  | "not-allowed"
  | "blocked"
  | "local-only"
  | "permission-only"
  | "subscribed";

export type NotificationEnableResult = "enabled" | "local-only" | "denied" | "unsupported";
export type NotificationSetupStage = "permission" | "service-worker" | "push-service" | "cloud";

export async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function notificationsSupported(): boolean {
  return "Notification" in window && "serviceWorker" in navigator;
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "default") return "not-allowed";
  if (Notification.permission === "denied") return "blocked";
  if (!("PushManager" in window) || !supabase || getCurrentUserId() === "local" || !vapidPublicKey) {
    return "local-only";
  }
  try {
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      6_000,
      "等待 Service Worker 超时"
    );
    const subscription = await withTimeout(
      registration.pushManager.getSubscription(),
      6_000,
      "读取系统推送订阅超时"
    );
    return subscription ? "subscribed" : "permission-only";
  } catch {
    return "permission-only";
  }
}

export async function enableNotifications(
  onStage?: (stage: NotificationSetupStage) => void
): Promise<NotificationEnableResult> {
  if (!notificationsSupported()) return "unsupported";
  onStage?.("permission");
  const permission = Notification.permission === "default"
    ? await withTimeout(
      Notification.requestPermission(),
      30_000,
      "通知授权未完成，请重新点击并允许浏览器通知"
    )
    : Notification.permission;
  if (permission !== "granted") return "denied";

  const userId = getCurrentUserId();
  if (!supabase || userId === "local" || !vapidPublicKey || !("PushManager" in window)) {
    return "local-only";
  }

  onStage?.("service-worker");
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    8_000,
    "等待应用后台服务超时，请刷新页面后重试"
  );
  onStage?.("push-service");
  const existing = await withTimeout(
    registration.pushManager.getSubscription(),
    6_000,
    "读取手机推送状态超时"
  );
  const subscription = existing ?? await withTimeout(
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    }),
    15_000,
    "连接手机系统推送服务超时。请检查 Chrome 通知权限、VPN/网络和 Google 推送服务"
  );
  const json = subscription.toJSON();
  onStage?.("cloud");
  const { error } = await withTimeout(
    supabase.rpc("register_push_subscription", {
      target_endpoint: subscription.endpoint,
      target_p256dh: json.keys?.p256dh,
      target_auth: json.keys?.auth,
      target_device_id: getDeviceId(),
      target_user_agent: navigator.userAgent
    }),
    12_000,
    "保存云端推送订阅超时，请检查当前网络后重试"
  );
  if (error) throw new Error(`通知订阅失败：${error.message}`);
  return "enabled";
}

export async function disableNotificationsForCurrentDevice(): Promise<void> {
  if (!notificationsSupported() || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  if (supabase && getCurrentUserId() !== "local") {
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  }
  await subscription.unsubscribe();
}

async function showReminder(title: string, body: string, tag: string) {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    tag,
    icon: `${import.meta.env.BASE_URL}app-icon-192.png`,
    badge: `${import.meta.env.BASE_URL}app-icon-192.png`,
    data: { url: new URL(import.meta.env.BASE_URL, window.location.origin).toString() }
  });
}

export async function showTestNotification(): Promise<void> {
  if (!notificationsSupported()) throw new Error("当前浏览器不支持系统通知");
  if (Notification.permission !== "granted") throw new Error("请先允许系统通知");
  await showReminder(
    "日程计划表测试通知",
    "通知显示正常。点击此通知可测试应用跳转。",
    `schedule-test-${Date.now()}`
  );
}

const REMINDER_SCHEDULE_FIELDS = [
  "event_type",
  "start_date",
  "end_date",
  "start_time",
  "all_day",
  "recurrence_type",
  "recurrence_until",
  "reminder_enabled",
  "reminder_minutes_before",
  "timezone"
] as const satisfies readonly (keyof EventItem)[];

export function reminderScheduleChanged(previous: EventItem, next: EventItem): boolean {
  return REMINDER_SCHEDULE_FIELDS.some((field) => previous[field] !== next[field]);
}

export async function resetSentRemindersForChangedEvent(
  previous: EventItem | undefined,
  next: EventItem
): Promise<number> {
  if (!previous || !reminderScheduleChanged(previous, next)) return 0;
  const states = await db.eventOccurrenceStates
    .filter((state) => state.event_id === next.id && !state.deleted_at && Boolean(state.reminder_sent_at))
    .toArray();
  for (const state of states) {
    const updated = {
      ...syncFields(state),
      event_id: state.event_id,
      occurrence_date: state.occurrence_date,
      completed: state.completed,
      reminder_sent_at: null
    };
    await db.eventOccurrenceStates.put(updated);
    await queueChange("eventOccurrenceStates", updated.id);
  }
  return states.length;
}

export async function checkDueLocalReminders(ownerId: string): Promise<number> {
  if (!notificationsSupported() || Notification.permission !== "granted") return 0;
  const now = new Date();
  const date = toISODate(now);
  const events = await db.events
    .filter((event) => event.user_id === ownerId && !event.deleted_at && event.reminder_enabled && eventOccursOn(event, now))
    .toArray();
  let sent = 0;
  for (const event of events) {
    const startTime = event.start_time ?? "09:00";
    if (!reminderIsDue(event, now, now)) continue;

    const existing = await db.eventOccurrenceStates
      .where("[event_id+occurrence_date]")
      .equals([event.id, date])
      .filter((state) => !state.deleted_at)
      .first();
    if (existing?.reminder_sent_at) continue;

    await showReminder(
      event.title,
      event.all_day ? "今天的全天事项" : `${startTime} 开始`,
      `event-${event.id}-${date}`
    );
    const state = {
      ...syncFields(existing),
      event_id: event.id,
      occurrence_date: date,
      completed: existing?.completed ?? false,
      reminder_sent_at: new Date().toISOString()
    };
    await db.eventOccurrenceStates.put(state);
    await queueChange("eventOccurrenceStates", state.id);
    sent += 1;
  }

  const anniversaries = await db.anniversaries
    .filter((anniversary) => anniversary.user_id === ownerId && !anniversary.deleted_at && anniversary.reminder_enabled)
    .toArray();
  for (const anniversary of anniversaries) {
    const occurrence = dueAnniversaryOccurrence(anniversary, now);
    if (!occurrence) continue;
    const occurrenceDate = toISODate(occurrence);
    if (anniversary.reminder_sent_for === occurrenceDate) continue;

    await showReminder(
      anniversary.title,
      formatAnniversaryReminderBody(anniversary, occurrence, now),
      `anniversary-${anniversary.id}-${occurrenceDate}`
    );
    const updated: Anniversary = {
      ...anniversary,
      ...syncFields(anniversary),
      reminder_sent_for: occurrenceDate
    };
    await db.anniversaries.put(updated);
    await queueChange("anniversaries", updated.id);
    sent += 1;
  }
  return sent;
}
