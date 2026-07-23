import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { appHistoryLayer, appHistoryPage } from "./appHistory";

export const NATIVE_NOTIFICATION_OPEN_EVENT = "semester-schedule-native-notification-open";
let pendingNotificationKey: string | null = null;

function notificationKeyFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "semesterschedule:") return null;
    if (parsed.hostname === "focus") return "route:focus";
    if (parsed.hostname !== "notification") return null;
    return parsed.searchParams.get("key");
  } catch {
    return null;
  }
}

function publishNotificationUrl(url?: string | null) {
  const key = notificationKeyFromUrl(url);
  if (!key) return;
  pendingNotificationKey = key;
  window.dispatchEvent(new CustomEvent<string>(NATIVE_NOTIFICATION_OPEN_EVENT, { detail: key }));
}

export function consumePendingNativeNotificationKey(): string | null {
  const value = pendingNotificationKey;
  pendingNotificationKey = null;
  return value;
}

export function isNativeApp(): boolean {
  return typeof __APP_TARGET__ !== "undefined" && __APP_TARGET__ === "android" && Capacitor.isNativePlatform();
}

export async function initializeNativeAppBridge(): Promise<void> {
  if (!isNativeApp()) return;

  try {
    publishNotificationUrl((await CapacitorApp.getLaunchUrl())?.url);
    await CapacitorApp.addListener("appUrlOpen", ({ url }) => publishNotificationUrl(url));
    await CapacitorApp.addListener("backButton", () => {
      const page = appHistoryPage(window.history.state);
      if (appHistoryLayer(window.history.state) || (page !== null && page !== "today")) {
        window.history.back();
        return;
      }
      void CapacitorApp.minimizeApp();
    });
  } catch {
    // Capacitor's default Android back handling remains available if the plugin cannot initialize.
  }
}
