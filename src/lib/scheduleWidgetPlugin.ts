import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./nativeApp";

export interface ScheduleWidgetPinResult {
  supported: boolean;
  requested: boolean;
  alreadyAdded?: boolean;
  status?: "request_accepted" | "request_rejected" | "unsupported_android" | "unsupported_launcher" | "no_activity" | "error";
}

/**
 * The Android home-screen widget is deliberately a read-only projection of the
 * WebView database.  The native side stores only the latest compact snapshot;
 * all writes to Dexie and the sync queue continue to happen in the web app.
 */
export interface ScheduleWidgetPlugin {
  requestPin(): Promise<ScheduleWidgetPinResult>;
  setActiveOwner(options: { ownerId: string }): Promise<{ accepted: boolean }>;
  updateSnapshot(options: {
    ownerId: string;
    snapshotJson?: string;
  }): Promise<{ accepted: boolean; updated?: boolean }>;
  clearSnapshot(): Promise<void>;
}

export const ScheduleWidget = registerPlugin<ScheduleWidgetPlugin>("ScheduleWidget");

export async function requestScheduleWidgetPin(): Promise<ScheduleWidgetPinResult> {
  if (!isNativeApp()) return { supported: false, requested: false };
  return ScheduleWidget.requestPin();
}
