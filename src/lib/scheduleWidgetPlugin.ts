import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./nativeApp";

export interface ScheduleWidgetPinResult {
  supported: boolean;
  requested: boolean;
  alreadyAdded?: boolean;
  status?: "request_accepted" | "request_rejected" | "unsupported_android" | "unsupported_launcher" | "no_activity" | "error";
}

export type ScheduleWidgetCompletionKind = "todo" | "event";

export interface ScheduleWidgetCompletionAction {
  actionId: string;
  kind: ScheduleWidgetCompletionKind;
  targetId: string;
  occurrenceDate?: string;
  createdAt: string;
}

/**
 * The native widget keeps a compact projection plus an idempotent completion
 * outbox.  It never writes the WebView database directly: pending actions are
 * consumed here and still flow through Dexie and the normal sync queue.
 */
export interface ScheduleWidgetPlugin {
  requestPin(): Promise<ScheduleWidgetPinResult>;
  setActiveOwner(options: { ownerId: string }): Promise<{ accepted: boolean }>;
  updateSnapshot(options: {
    ownerId: string;
    snapshotJson?: string;
  }): Promise<{ accepted: boolean; updated?: boolean }>;
  getPendingCompletionActions(options: {
    ownerId: string;
  }): Promise<{ accepted: boolean; actions: ScheduleWidgetCompletionAction[] }>;
  ackCompletionActions(options: {
    ownerId: string;
    actionIds: string[];
  }): Promise<{ accepted: boolean; acknowledged: number }>;
  clearSnapshot(): Promise<void>;
}

export const ScheduleWidget = registerPlugin<ScheduleWidgetPlugin>("ScheduleWidget");

export async function requestScheduleWidgetPin(): Promise<ScheduleWidgetPinResult> {
  if (!isNativeApp()) return { supported: false, requested: false };
  return ScheduleWidget.requestPin();
}
