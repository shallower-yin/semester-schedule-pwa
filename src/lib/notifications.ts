import { db, queueChange } from "../db";
import { dueAnniversaryOccurrence, formatAnniversaryReminderBody } from "./anniversaries";
import { eventOccursOn, toISODate } from "./date";
import { getCurrentUserId, getDeviceId, syncFields } from "./identity";
import { reminderIsDue } from "./reminderTime";
import { supabase } from "./supabase";
import type { Anniversary, EventItem, EventOccurrenceState } from "../types";
import { isNativeApp } from "./nativeApp";
import {
  cancelAllNativeReminders,
  ensureNativeExactAlarmPermission,
  ensureNativeReminderPermission,
  getNativeReminderDiagnostics,
  getNativeReminderHealth,
  showNativeNotificationNow,
  syncNativeReminders
} from "./nativeReminders";
import { computeScheduledReminders, HEALTH_NOTIFICATION_ID, TEST_NOTIFICATION_ID } from "./reminderSchedule";
import { withTimeout } from "./asyncTimeout";

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
export interface NotificationDiagnosticStep {
  id: NotificationSetupStage | "support" | "channel" | "exact-alarm" | "pending" | "delivery" | "battery" | "last-exit" | "native-trace";
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export { withTimeout };

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
  if (isNativeApp()) {
    const health = await getNativeReminderHealth();
    if (!health?.permissionGranted || !health.notificationsEnabled) return "not-allowed";
    return health.exactAlarmAllowed && health.channelReady ? "subscribed" : "permission-only";
  }
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
      "等待应用后台服务超时"
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
  if (isNativeApp()) {
    onStage?.("permission");
    if ((await ensureNativeReminderPermission(true)) !== "granted") return "denied";
    if (!(await ensureNativeExactAlarmPermission(true))) {
      throw new Error("请在安卓系统设置中允许“闹钟和提醒”，否则熄屏或清理后台后可能延迟。 ");
    }
    await rescheduleNativeReminders(getCurrentUserId());
    return "enabled";
  }
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
  if (isNativeApp()) {
    await cancelAllNativeReminders();
    return;
  }
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

export async function showHealthMovementReminder(): Promise<void> {
  if (isNativeApp()) {
    await showNativeNotificationNow({
      id: HEALTH_NOTIFICATION_ID,
      title: "起来活动一下",
      body: "喝口水，活动肩颈或走动几分钟。完成后可在健康页记录。"
    });
    return;
  }
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  await showReminder(
    "起来活动一下",
    "喝口水，活动肩颈或走动几分钟。完成后可在健康页记录。",
    "health-movement-reminder"
  );
}

export async function diagnoseNotifications(): Promise<NotificationDiagnosticStep[]> {
  const steps: NotificationDiagnosticStep[] = [];
  if (isNativeApp()) {
    const [health, diagnostics] = await Promise.all([getNativeReminderHealth(), getNativeReminderDiagnostics()]);
    const granted = Boolean(health?.permissionGranted && health.notificationsEnabled);
    steps.push({ id: "support", label: "提醒方式", status: "ok", detail: "使用安卓本地精确闹钟，不依赖 TPNS，也不要求应用驻留后台。" });
    steps.push({
      id: "permission",
      label: "通知权限",
      status: granted ? "ok" : "warning",
      detail: granted ? "已允许安卓通知权限。" : "尚未允许通知，点击启用提醒后在系统弹窗中选择允许。"
    });
    steps.push({
      id: "channel",
      label: "锁屏提醒渠道",
      status: health?.channelReady && health.channelSoundEnabled ? "ok" : "warning",
      detail: health?.channelReady && health.channelSoundEnabled
        ? "高优先级、有声、振动、锁屏可见渠道正常。"
        : "提醒渠道被静音或降级，请到系统通知设置中将“日程提醒（响铃与振动）”设为允许并开启声音和振动。"
    });
    steps.push({
      id: "exact-alarm",
      label: "精确闹钟",
      status: health?.exactAlarmAllowed ? "ok" : "error",
      detail: health?.exactAlarmAllowed
        ? "已允许精确闹钟，熄屏时由 Android AlarmManager 唤醒提醒。"
        : "未允许“闹钟和提醒”，请点击启用提醒并在系统设置中授权。"
    });
    steps.push({
      id: "pending",
      label: "系统待发队列",
      status: health?.lastError ? "warning" : "ok",
      detail: health?.lastError
        ? `最近一次安排异常：${health.lastError}`
        : `原生 AlarmManager 当前持久化了 ${health?.pendingCount ?? 0} 条待发日程提醒${diagnostics?.nextTriggerAt ? `，最近一条为 ${new Date(diagnostics.nextTriggerAt).toLocaleString("zh-CN", { hour12: false })}` : ""}。`
    });
    const lastDelivery = diagnostics?.lastNotifiedAt || diagnostics?.lastReceivedAt || 0;
    steps.push({
      id: "delivery",
      label: "原生触发记录",
      status: lastDelivery ? "ok" : "warning",
      detail: lastDelivery
        ? `安卓接收器最近在 ${new Date(lastDelivery).toLocaleString("zh-CN", { hour12: false })} ${diagnostics?.lastNotifiedAt ? "成功发布了通知" : "已被系统唤醒"}。`
        : "尚无真实触发记录。请运行“2 分钟后台提醒测试”，这比仅查看待发队列更可靠。"
    });
    steps.push({
      id: "battery",
      label: "省电策略",
      status: health?.batteryOptimizationIgnored ? "ok" : "warning",
      detail: health?.batteryOptimizationIgnored
        ? "应用不受系统电池优化限制。"
        : "当前受电池优化限制；精确闹钟通常仍可触发，但部分国产系统建议同时允许自启动并设为“不限制”。"
    });
    if (health?.lastExitReason) {
      steps.push({
        id: "last-exit",
        label: "上次进程退出",
        status: "warning",
        detail: `Android 记录：${health.lastExitReason}`
      });
    }
    const recentEvents = diagnostics?.events?.slice(0, 8) ?? [];
    if (recentEvents.length) {
      const stageLabels: Record<string, string> = {
        scheduled: "已注册",
        received: "接收器已唤醒",
        notified: "通知已发布",
        notify_denied: "发布被拒绝",
        restored: "已恢复",
        schedule_error: "注册失败",
        restore_error: "恢复失败"
      };
      steps.push({
        id: "native-trace",
        label: "最近原生轨迹",
        status: recentEvents.some((item) => /error|denied/.test(item.stage)) ? "warning" : "ok",
        detail: recentEvents.map((item) =>
          `${new Date(item.at).toLocaleTimeString("zh-CN", { hour12: false })} ${stageLabels[item.stage] ?? item.stage}${item.id ? ` #${item.id}` : ""}`
        ).join("；")
      });
    }
    return steps;
  }
  if (!notificationsSupported()) {
    return [{
      id: "support",
      label: "浏览器能力",
      status: "error",
      detail: "当前浏览器不支持系统通知或应用后台服务。"
    }];
  }

  steps.push({ id: "support", label: "浏览器能力", status: "ok", detail: "支持系统通知和应用后台服务。" });

  if (Notification.permission === "denied") {
    steps.push({ id: "permission", label: "通知权限", status: "error", detail: "浏览器已阻止通知，需要在网站权限中改为允许。" });
    return steps;
  }
  if (Notification.permission === "default") {
    steps.push({ id: "permission", label: "通知权限", status: "warning", detail: "尚未允许通知，点击启用提醒时需要选择允许。" });
    return steps;
  }
  steps.push({ id: "permission", label: "通知权限", status: "ok", detail: "浏览器已允许通知。" });

  try {
    const registration = await withTimeout(navigator.serviceWorker.ready, 6_000, "等待应用后台服务超时");
    steps.push({ id: "service-worker", label: "后台服务", status: "ok", detail: registration.active ? "应用后台服务已激活。" : "应用后台服务已就绪。" });

    if (!("PushManager" in window)) {
      steps.push({ id: "push-service", label: "系统推送", status: "warning", detail: "当前环境不支持关闭应用后的提醒，只能在应用打开时提醒。" });
      return steps;
    }
    if (!supabase || getCurrentUserId() === "local" || !vapidPublicKey) {
      steps.push({ id: "push-service", label: "系统推送", status: "warning", detail: "未登录或未完成提醒配置，只能在应用打开时提醒。" });
      return steps;
    }
    const subscription = await withTimeout(registration.pushManager.getSubscription(), 6_000, "读取系统推送订阅超时");
    steps.push({
      id: "push-service",
      label: "系统推送",
      status: subscription ? "ok" : "warning",
      detail: subscription ? "当前设备已有系统推送订阅。" : "尚未建立系统推送订阅，可点击启用提醒。"
    });
    steps.push({
      id: "cloud",
      label: "后台提醒",
      status: subscription ? "ok" : "warning",
      detail: subscription ? "应用关闭后的提醒已准备好。" : "未启用时，应用关闭后不会收到提醒。"
    });
  } catch (error) {
    steps.push({
      id: "service-worker",
      label: "后台服务",
      status: "error",
      detail: error instanceof Error ? error.message : "后台服务检查失败。"
    });
  }

  return steps;
}

export async function showTestNotification(): Promise<void> {
  if (isNativeApp()) {
    const shown = await showNativeNotificationNow({
      id: TEST_NOTIFICATION_ID,
      title: "日程计划表测试通知",
      body: "通知显示正常。应用关闭后仍会按时提醒。"
    });
    if (!shown) throw new Error("请先允许系统通知");
    return;
  }
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
  "recurrence_interval",
  "reminder_enabled",
  "reminder_minutes_before",
  "timezone"
] as const satisfies readonly (keyof EventItem)[];

export function reminderScheduleChanged(previous: EventItem, next: EventItem): boolean {
  return REMINDER_SCHEDULE_FIELDS.some((field) => previous[field] !== next[field]);
}

export function reminderOccurrenceCanSend(
  state: Pick<EventOccurrenceState, "completed" | "reminder_sent_at"> | undefined
): boolean {
  return !state?.completed && !state?.reminder_sent_at;
}

export function eventReminderCanSend(event: Pick<EventItem, "deleted_at" | "reminder_enabled" | "completed_at">): boolean {
  return !event.deleted_at && event.reminder_enabled && !event.completed_at;
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

// Loads the current user's reminder-eligible data and hands the computed schedule to the native OS.
// Cancels/updates/adds OS notifications so they stay in sync with events and anniversaries.
async function rescheduleNativeReminders(ownerId: string): Promise<number> {
  const [events, anniversaries, occurrenceStates] = await Promise.all([
    db.events.filter((event) => event.user_id === ownerId).toArray(),
    db.anniversaries.filter((anniversary) => anniversary.user_id === ownerId).toArray(),
    db.eventOccurrenceStates.filter((state) => state.user_id === ownerId).toArray()
  ]);
  const reminders = computeScheduledReminders({ events, anniversaries, occurrenceStates });
  return syncNativeReminders(reminders);
}

export async function checkDueLocalReminders(ownerId: string): Promise<number> {
  if (isNativeApp()) return rescheduleNativeReminders(ownerId);
  if (!notificationsSupported() || Notification.permission !== "granted") return 0;
  const now = new Date();
  const events = await db.events
    .filter((event) => event.user_id === ownerId && eventReminderCanSend(event))
    .toArray();
  let sent = 0;
  for (const event of events) {
    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const occurrenceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
      if (!eventOccursOn(event, occurrenceDate) || !reminderIsDue(event, occurrenceDate, now)) continue;
      const date = toISODate(occurrenceDate);
      const startTime = event.start_time ?? "09:00";
      const existing = await db.eventOccurrenceStates
        .where("[event_id+occurrence_date]")
        .equals([event.id, date])
        .filter((state) => !state.deleted_at)
        .first();
      if (!reminderOccurrenceCanSend(existing)) continue;

      await showReminder(
        event.title,
        event.all_day ? `${date} 全天事项` : `${date} ${startTime} 开始`,
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
