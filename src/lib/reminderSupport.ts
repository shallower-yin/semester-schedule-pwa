import { registerPlugin } from "@capacitor/core";

export interface ReminderSystemStatus {
  notificationsEnabled: boolean;
  exactAlarmAllowed: boolean;
  batteryOptimizationIgnored: boolean;
  channelImportance: number;
  channelSoundEnabled: boolean;
  channelVibrationEnabled: boolean;
  sdkInt: number;
}

interface ReminderSupportPlugin {
  ensureChannel(): Promise<ReminderSystemStatus>;
  getSystemStatus(): Promise<ReminderSystemStatus>;
}

export const ReminderSupport = registerPlugin<ReminderSupportPlugin>("ReminderSupport");
