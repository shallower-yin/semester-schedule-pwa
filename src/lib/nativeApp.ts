import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { appHistoryLayer, appHistoryPage } from "./appHistory";

export function isNativeApp(): boolean {
  return typeof __APP_TARGET__ !== "undefined" && __APP_TARGET__ === "android" && Capacitor.isNativePlatform();
}

export async function initializeNativeAppBridge(): Promise<void> {
  if (!isNativeApp()) return;

  try {
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
