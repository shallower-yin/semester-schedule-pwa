import { registerPlugin } from "@capacitor/core";
import type { ActiveFocusState } from "./focus";
import { elapsedFocusSeconds } from "./focus";
import { isNativeApp } from "./nativeApp";

interface NativeTimerState {
  active: boolean;
  ownerId: string;
  mode: string;
  title: string;
  plannedSeconds: number;
  elapsedSeconds: number;
  paused: boolean;
  lockTaskActive: boolean;
}

interface FocusNativeTimerPlugin {
  start(options: {
    ownerId: string;
    mode: string;
    title: string;
    plannedSeconds: number;
    initialElapsedSeconds: number;
  }): Promise<NativeTimerState>;
  pause(): Promise<NativeTimerState>;
  resume(): Promise<NativeTimerState>;
  getState(): Promise<NativeTimerState>;
  stop(): Promise<void>;
  enterLockTask(): Promise<{ active: boolean }>;
  exitLockTask(): Promise<{ active: boolean }>;
}

const FocusNativeTimer = registerPlugin<FocusNativeTimerPlugin>("FocusNativeTimer");

export async function startNativeFocusTimer(ownerId: string, active: ActiveFocusState): Promise<number | null> {
  if (!isNativeApp()) return null;
  const state = await FocusNativeTimer.start({
    ownerId,
    mode: active.mode,
    title: active.task_title,
    plannedSeconds: active.planned_seconds ?? -1,
    initialElapsedSeconds: elapsedFocusSeconds(active)
  });
  return state.elapsedSeconds;
}

export async function readNativeFocusTimer(ownerId: string): Promise<NativeTimerState | null> {
  if (!isNativeApp()) return null;
  const state = await FocusNativeTimer.getState();
  return state.active && state.ownerId === ownerId ? state : null;
}

export async function pauseNativeFocusTimer(): Promise<number | null> {
  if (!isNativeApp()) return null;
  return (await FocusNativeTimer.pause()).elapsedSeconds;
}

export async function resumeNativeFocusTimer(): Promise<number | null> {
  if (!isNativeApp()) return null;
  return (await FocusNativeTimer.resume()).elapsedSeconds;
}

export async function stopNativeFocusTimer(exitLockTask: boolean): Promise<void> {
  if (!isNativeApp()) return;
  if (exitLockTask) {
    try { await FocusNativeTimer.exitLockTask(); } catch { /* already unpinned */ }
  }
  await FocusNativeTimer.stop();
}

export async function enterNativeLockTask(): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await FocusNativeTimer.enterLockTask()).active;
}
