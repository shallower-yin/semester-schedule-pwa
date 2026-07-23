import { registerPlugin } from "@capacitor/core";

export interface ReminderSystemStatus {
  notificationsEnabled: boolean;
  exactAlarmAllowed: boolean;
  batteryOptimizationIgnored: boolean;
  channelImportance: number;
  channelSoundEnabled: boolean;
  channelVibrationEnabled: boolean;
  sdkInt: number;
  scheduledCount?: number;
  nextTriggerAt?: number;
}

export interface ReminderDiagnosticEvent {
  at: number;
  stage: string;
  id: number;
  detail: string;
}

export interface ReminderDiagnostics extends ReminderSystemStatus {
  scheduledCount: number;
  nextTriggerAt: number;
  lastReceivedAt: number;
  lastNotifiedAt: number;
  events: ReminderDiagnosticEvent[];
}

export interface NativeReminderInput {
  id: number;
  title: string;
  body: string;
  key: string;
  sig: string;
  triggerAt: number;
}

interface ReminderSupportPlugin {
  ensureChannel(): Promise<ReminderSystemStatus>;
  getSystemStatus(): Promise<ReminderSystemStatus>;
  scheduleReminders(options: { reminders: NativeReminderInput[] }): Promise<ReminderSystemStatus>;
  cancelAll(): Promise<ReminderSystemStatus>;
  postNow(options: { id: number; title: string; body: string; key: string }): Promise<ReminderSystemStatus>;
  scheduleTest(options: { id: number; delaySeconds: number }): Promise<ReminderSystemStatus & { triggerAt: number }>;
  getDiagnostics(): Promise<ReminderDiagnostics>;
}

export const ReminderSupport = registerPlugin<ReminderSupportPlugin>("ReminderSupport");
