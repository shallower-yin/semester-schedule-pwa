import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { appHistoryLayer, appHistoryPage } from "./appHistory";

export const NATIVE_NOTIFICATION_OPEN_EVENT = "semester-schedule-native-notification-open";
const NATIVE_APP_STATE_CHANGE_EVENT = "semester-schedule-native-app-state-change";
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

export function subscribeToAppForeground(onForeground: () => void | Promise<unknown>): () => void {
  let active = true;
  let notifying = false;
  const notify = () => {
    if (!active || notifying || !navigator.onLine) return;
    notifying = true;
    void Promise.resolve()
      .then(() => active ? onForeground() : undefined)
      .catch(() => undefined)
      .finally(() => { notifying = false; });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") notify();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onVisible();
  };
  const onNativeStateChange = (event: Event) => {
    if ((event as CustomEvent<boolean>).detail) notify();
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener(NATIVE_APP_STATE_CHANGE_EVENT, onNativeStateChange);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener(NATIVE_APP_STATE_CHANGE_EVENT, onNativeStateChange);
  };
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
    await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      window.dispatchEvent(new CustomEvent<boolean>(NATIVE_APP_STATE_CHANGE_EVENT, { detail: isActive }));
    });
  } catch {
    // Capacitor's default Android back handling remains available if the plugin cannot initialize.
  }
}
