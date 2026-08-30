import { registerPlugin } from "@capacitor/core";

/**
 * The Android home-screen widget is deliberately a read-only projection of the
 * WebView database.  The native side stores only the latest compact snapshot;
 * all writes to Dexie and the sync queue continue to happen in the web app.
 */
export interface ScheduleWidgetPlugin {
  setActiveOwner(options: { ownerId: string }): Promise<{ accepted: boolean }>;
  updateSnapshot(options: {
    ownerId: string;
    snapshotJson?: string;
  }): Promise<{ accepted: boolean; updated?: boolean }>;
  clearSnapshot(): Promise<void>;
}

export const ScheduleWidget = registerPlugin<ScheduleWidgetPlugin>("ScheduleWidget");
