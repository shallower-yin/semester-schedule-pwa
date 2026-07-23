import { registerPlugin } from "@capacitor/core";
import type { ActiveFocusState } from "./focus";
import { elapsedFocusSeconds } from "./focus";
import { isNativeApp } from "./nativeApp";

export interface NativeTimerState {
  active: boolean;
  ownerId: string;
  mode: string;
  title: string;
  linkedEventId: string;
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: number;
  paused: boolean;
  pomodoroPlanId: string;
  pomodoroRound: number;
  pomodoroTotalRounds: number;
  pomodoroShortBreakSeconds: number;
  pomodoroLongBreakSeconds: number;
  pomodoroLongBreakInterval: number;
  pomodoroAutoStartBreak: boolean;
  pomodoroRestKind: string;
  lockTaskActive: boolean;
}

export interface NativeFocusTransition {
  id: string;
  ownerId: string;
  kind: "focus" | "rest";
  mode: string;
  title: string;
  linkedEventId: string;
  plannedSeconds: number;
  durationSeconds: number;
  startedAt: number;
  endedAt: number;
  pomodoroPlanId: string;
  pomodoroRound: number;
  pomodoroTotalRounds: number;
  restKind: "manual" | "pomodoro_short" | "pomodoro_long";
}

interface FocusNativeTimerPlugin {
  start(options: {
    ownerId: string;
    mode: string;
    title: string;
    linkedEventId: string;
    plannedSeconds: number;
    initialElapsedSeconds: number;
    pomodoroPlanId: string;
    pomodoroRound: number;
    pomodoroTotalRounds: number;
    pomodoroShortBreakSeconds: number;
    pomodoroLongBreakSeconds: number;
    pomodoroLongBreakInterval: number;
    pomodoroAutoStartBreak: boolean;
    pomodoroRestKind: string;
    soundEnabled: boolean;
  }): Promise<NativeTimerState>;
  pause(): Promise<NativeTimerState>;
  resume(): Promise<NativeTimerState>;
  getState(): Promise<NativeTimerState>;
  getTransitions(): Promise<{ transitions: NativeFocusTransition[] }>;
  clearTransitions(options: { ids: string[] }): Promise<void>;
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
    linkedEventId: active.linked_event_id ?? "",
    plannedSeconds: active.planned_seconds ?? -1,
    initialElapsedSeconds: elapsedFocusSeconds(active),
    pomodoroPlanId: active.pomodoro_plan_id ?? "",
    pomodoroRound: active.pomodoro_round ?? 0,
    pomodoroTotalRounds: active.pomodoro_total_rounds ?? 0,
    pomodoroShortBreakSeconds: active.pomodoro_short_break_seconds ?? 300,
    pomodoroLongBreakSeconds: active.pomodoro_long_break_seconds ?? 900,
    pomodoroLongBreakInterval: active.pomodoro_long_break_interval ?? 4,
    pomodoroAutoStartBreak: active.pomodoro_auto_start_break ?? false,
    pomodoroRestKind: active.pomodoro_rest_kind ?? "",
    soundEnabled: active.sound_enabled ?? true
  });
  return state.elapsedSeconds;
}

export async function readNativeFocusTimer(ownerId: string): Promise<NativeTimerState | null> {
  if (!isNativeApp()) return null;
  const state = await FocusNativeTimer.getState();
  return state.ownerId === ownerId ? state : null;
}

export async function readNativeFocusTransitions(ownerId?: string): Promise<NativeFocusTransition[]> {
  if (!isNativeApp()) return [];
  const transitions = (await FocusNativeTimer.getTransitions()).transitions;
  return ownerId ? transitions.filter((item) => !item.ownerId || item.ownerId === ownerId) : transitions;
}

export async function clearNativeFocusTransitions(ids: string[]): Promise<void> {
  if (!isNativeApp()) return;
  if (ids.length) await FocusNativeTimer.clearTransitions({ ids });
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
