import { isNativeApp } from "./nativeApp";
import { HEALTH_NOTIFICATION_ID, TEST_NOTIFICATION_ID, type ScheduledReminder } from "./reminderSchedule";
import { withTimeout } from "./asyncTimeout";
import { ReminderSupport, type ReminderDiagnostics, type ReminderSystemStatus } from "./reminderSupport";

// Native Android reminders. The browser keeps its Web Push / service-worker path; the APK WebView has
// no Notification API, so it schedules real Android local notifications through the OS AlarmManager
// (via @capacitor/local-notifications), which fire even when the app is closed. The plugin is imported
// lazily so it never enters the web bundle or the jsdom test environment.

const CHANNEL_ID = "reminders-v4";
// A native bridge call should return in milliseconds; anything longer is a stuck OEM implementation.
// Bounding every call keeps the account panel from freezing on "正在检查…" the way it once did.
const BRIDGE_TIMEOUT_MS = 8_000;
const PERMISSION_PROMPT_TIMEOUT_MS = 120_000;
let channelReady = false;
let lastNativeReminderError: string | null = null;
let legacyPendingCleaned = false;
let reliableServiceStarted = false;

export interface NativeReminderHealth extends ReminderSystemStatus {
  permissionGranted: boolean;
  pendingCount: number;
  channelReady: boolean;
  lastError: string | null;
}

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
    await withTimeout(ReminderSupport.ensureChannel(), BRIDGE_TIMEOUT_MS, "创建系统提醒渠道超时");
    channelReady = true;
    return;
  } catch {
    // Keep a Capacitor fallback for older APK shells that do not yet expose ReminderSupport.
    try {
      const { LocalNotifications } = await loadPlugin();
      await withTimeout(
        LocalNotifications.createChannel({
          id: CHANNEL_ID,
          name: "日程提醒",
          description: "事项、纪念日与活动提醒",
          importance: 4,
          visibility: 1,
          lights: true,
          lightColor: "#3157d5",
          vibration: false
        }),
        BRIDGE_TIMEOUT_MS,
        "创建通知渠道超时"
      );
    } catch (error) {
      // Channels only exist on Android 8+; older devices deliver on the default channel.
      lastNativeReminderError = error instanceof Error ? error.message : "创建通知渠道失败";
    }
  }
  channelReady = true;
}

export async function ensureNativeExactAlarmPermission(request: boolean): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { LocalNotifications } = await loadPlugin();
    let status = await withTimeout(LocalNotifications.checkExactNotificationSetting(), BRIDGE_TIMEOUT_MS, "读取精确提醒权限超时");
    if (status.exact_alarm !== "granted" && request) {
      status = await withTimeout(LocalNotifications.changeExactNotificationSetting(), PERMISSION_PROMPT_TIMEOUT_MS, "精确提醒授权超时");
    }
    return status.exact_alarm === "granted";
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "精确提醒权限检查失败";
    return false;
  }
}

export async function getNativeReminderHealth(): Promise<NativeReminderHealth | null> {
  if (!isNativeApp()) return null;
  const permissionGranted = (await ensureNativeReminderPermission(false)) === "granted";
  try {
    await ensureChannel();
    const system = await withTimeout(ReminderSupport.getSystemStatus(), BRIDGE_TIMEOUT_MS, "读取安卓提醒状态超时");
    return {
      ...system,
      permissionGranted,
      pendingCount: Math.max(0, system.scheduledCount ?? 0),
      channelReady: system.channelImportance >= 3,
      lastError: lastNativeReminderError
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取安卓提醒状态失败";
    lastNativeReminderError = message;
    return {
      notificationsEnabled: permissionGranted,
      exactAlarmAllowed: await ensureNativeExactAlarmPermission(false),
      batteryOptimizationIgnored: false,
      channelImportance: 0,
      channelSoundEnabled: false,
      channelVibrationEnabled: false,
      sdkInt: 0,
      permissionGranted,
      pendingCount: 0,
      channelReady: false,
      lastError: message
    };
  }
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
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "读取通知权限失败";
    return "denied";
  }
}

function signatureOf(reminder: ScheduledReminder): string {
  return `${reminder.title}${reminder.body}${reminder.at.getTime()}`;
}

async function cleanLegacyCapacitorPending(): Promise<void> {
  if (legacyPendingCleaned) return;
  legacyPendingCleaned = true;
  try {
    const { LocalNotifications } = await loadPlugin();
    const pending = (await withTimeout(LocalNotifications.getPending(), BRIDGE_TIMEOUT_MS, "读取旧提醒超时")).notifications;
    if (pending.length) {
      await withTimeout(
        LocalNotifications.cancel({ notifications: pending.map((item) => ({ id: item.id })) }),
        BRIDGE_TIMEOUT_MS,
        "迁移旧提醒超时"
      );
    }
  } catch {
    // A previous APK might not contain Capacitor Local Notifications; the v3 scheduler is independent.
  }
}

// Reconciles the OS's pending notifications with the desired set: cancels reminders that no longer
// apply, (re)schedules new or edited ones, and leaves unchanged ones untouched so there is no churn
// on the periodic sync. Reserved one-off ids (test/health) are never touched. Returns the desired count.
export async function syncNativeReminders(reminders: ScheduledReminder[]): Promise<number> {
  if (!isNativeApp()) return 0;
  if ((await ensureNativeReminderPermission(false)) !== "granted") return 0;
  try {
    await ensureChannel();
    await cleanLegacyCapacitorPending();
    const result = await withTimeout(
      ReminderSupport.scheduleReminders({
        reminders: reminders.map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        key: reminder.key,
        sig: signatureOf(reminder),
        triggerAt: reminder.at.getTime()
      })) }),
      BRIDGE_TIMEOUT_MS,
      "注册原生提醒超时"
    );
    const verifiedCount = Math.max(0, result.scheduledCount ?? reminders.length);
    if (verifiedCount !== reminders.length) {
      lastNativeReminderError = `系统仅保存了 ${verifiedCount}/${reminders.length} 条提醒`;
    } else {
      lastNativeReminderError = null;
    }
    return verifiedCount;
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "系统提醒安排失败";
    console.error("Native reminder sync failed", error);
    return 0;
  }
}

export async function cancelAllNativeReminders(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await withTimeout(ReminderSupport.cancelAll(), BRIDGE_TIMEOUT_MS, "取消提醒超时");
    await cleanLegacyCapacitorPending();
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "取消提醒失败";
    // Nothing scheduled or plugin unavailable.
  }
}

export async function syncNativeHealthReminder(options: {
  enabled: boolean;
  triggerAt?: Date;
  intervalMinutes?: number;
  startMinutes?: number;
  endMinutes?: number;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ensureChannel();
    await withTimeout(
      ReminderSupport.scheduleHealthReminder({
        enabled: options.enabled,
        triggerAt: options.triggerAt?.getTime(),
        intervalMinutes: options.intervalMinutes,
        startMinutes: options.startMinutes,
        endMinutes: options.endMinutes
      }),
      BRIDGE_TIMEOUT_MS,
      "注册健康活动提醒超时"
    );
    lastNativeReminderError = null;
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "健康活动提醒安排失败";
    throw error;
  }
}

export async function ensureNativeReliableReminderService(): Promise<void> {
  if (!isNativeApp()) return;
  if (reliableServiceStarted) return;
  try {
    await ensureChannel();
    await withTimeout(ReminderSupport.startReliableService(), BRIDGE_TIMEOUT_MS, "启动可靠提醒服务超时");
    reliableServiceStarted = true;
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "可靠提醒服务启动失败";
    throw error;
  }
}

export async function stopNativeReliableReminderService(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await withTimeout(ReminderSupport.stopReliableService(), BRIDGE_TIMEOUT_MS, "停止可靠提醒服务超时");
    reliableServiceStarted = false;
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "可靠提醒服务停止失败";
  }
}

// Delivers a notification immediately (test button / health movement reminder).
export async function showNativeNotificationNow(options: { id: number; title: string; body: string }): Promise<boolean> {
  if ((await ensureNativeReminderPermission(false)) !== "granted") return false;
  try {
    await ensureChannel();
    await withTimeout(
      ReminderSupport.postNow({ ...options, key: options.id === HEALTH_NOTIFICATION_ID ? "health" : "test:immediate" }),
      BRIDGE_TIMEOUT_MS,
      "发送通知超时"
    );
    return true;
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "发送通知失败";
    return false;
  }
}

export async function scheduleNativeReminderTest(delaySeconds = 120): Promise<Date> {
  if ((await ensureNativeReminderPermission(false)) !== "granted") throw new Error("请先允许系统通知");
  if (!(await ensureNativeExactAlarmPermission(false))) throw new Error("请先允许“闹钟和提醒”权限");
  await ensureChannel();
  const result = await withTimeout(
    ReminderSupport.scheduleTest({ id: TEST_NOTIFICATION_ID, delaySeconds }),
    BRIDGE_TIMEOUT_MS,
    "注册后台测试提醒超时"
  );
  return new Date(result.triggerAt);
}

export async function getNativeReminderDiagnostics(): Promise<ReminderDiagnostics | null> {
  if (!isNativeApp()) return null;
  try {
    return await withTimeout(ReminderSupport.getDiagnostics(), BRIDGE_TIMEOUT_MS, "读取提醒诊断超时");
  } catch (error) {
    lastNativeReminderError = error instanceof Error ? error.message : "读取提醒诊断失败";
    return null;
  }
}

export async function openNativeReminderChannelSettings(): Promise<void> {
  if (isNativeApp()) await ReminderSupport.openChannelSettings();
}

export async function openNativeReminderAppSettings(): Promise<void> {
  if (isNativeApp()) await ReminderSupport.openAppSettings();
}

export async function requestNativeReminderBatteryExemption(): Promise<void> {
  if (isNativeApp()) await ReminderSupport.requestBatteryExemption();
}
