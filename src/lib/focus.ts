import type { FocusSession, FocusTimerMode } from "../types";
import { toISODate } from "./date";

export interface ActiveFocusState {
  mode: FocusTimerMode;
  task_title: string;
  linked_event_id: string | null;
  planned_seconds: number | null;
  started_at: string;
  paused_seconds: number;
  pause_started_at: string | null;
  pomodoro_plan_id?: string | null;
  pomodoro_round?: number | null;
  pomodoro_total_rounds?: number | null;
  pomodoro_short_break_seconds?: number | null;
  pomodoro_long_break_seconds?: number | null;
  pomodoro_long_break_interval?: number | null;
  pomodoro_auto_start_break?: boolean;
  pomodoro_rest_kind?: "pomodoro_short" | "pomodoro_long" | null;
  sound_enabled?: boolean;
}

export interface PomodoroPlanState {
  id: string;
  task_title: string;
  linked_event_id: string | null;
  total_rounds: number;
  next_round: number;
  completed_rounds: number;
}

export const FOCUS_STATE_CHANGED_EVENT = "semester-schedule-focus-state-changed";

export function activeFocusStorageKey(ownerId: string): string {
  return `semester-schedule-active-focus:${ownerId}`;
}

export function loadActiveFocus(ownerId: string): ActiveFocusState | null {
  try {
    const raw = localStorage.getItem(activeFocusStorageKey(ownerId));
    return raw ? JSON.parse(raw) as ActiveFocusState : null;
  } catch {
    return null;
  }
}

export function saveActiveFocus(ownerId: string, active: ActiveFocusState): void {
  localStorage.setItem(activeFocusStorageKey(ownerId), JSON.stringify(active));
  window.dispatchEvent(new CustomEvent(FOCUS_STATE_CHANGED_EVENT));
}

export function clearActiveFocus(ownerId: string): void {
  localStorage.removeItem(activeFocusStorageKey(ownerId));
  window.dispatchEvent(new CustomEvent(FOCUS_STATE_CHANGED_EVENT));
}

export function pomodoroPlanStorageKey(ownerId: string): string {
  return `semester-schedule-pomodoro-plan:${ownerId}`;
}

export function loadPomodoroPlan(ownerId: string): PomodoroPlanState | null {
  try {
    const raw = localStorage.getItem(pomodoroPlanStorageKey(ownerId));
    return raw ? JSON.parse(raw) as PomodoroPlanState : null;
  } catch {
    return null;
  }
}

export function savePomodoroPlan(ownerId: string, plan: PomodoroPlanState): void {
  localStorage.setItem(pomodoroPlanStorageKey(ownerId), JSON.stringify(plan));
}

export function clearPomodoroPlan(ownerId: string): void {
  localStorage.removeItem(pomodoroPlanStorageKey(ownerId));
}

export function pomodoroRestKind(active: ActiveFocusState): "pomodoro_short" | "pomodoro_long" {
  const round = Math.max(1, active.pomodoro_round ?? 1);
  const interval = Math.max(1, active.pomodoro_long_break_interval ?? 4);
  const total = Math.max(round, active.pomodoro_total_rounds ?? round);
  return round % interval === 0 || round >= total ? "pomodoro_long" : "pomodoro_short";
}

export function requestFocusNotificationPermission(): void {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  void Notification.requestPermission();
}

export function notifyFocusComplete(taskTitle: string, soundEnabled: boolean): void {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("专注结束", {
      body: taskTitle,
      icon: `${import.meta.env.BASE_URL}app-icon-192.png`
    });
  }
  if (!soundEnabled) return;
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      void audioContext.close();
    }, 360);
  } catch {
    // 浏览器可能禁止非用户手势音频，系统通知仍可正常显示。
  }
}

export function elapsedFocusSeconds(active: ActiveFocusState, now = new Date()): number {
  const started = new Date(active.started_at).getTime();
  const currentPause = active.pause_started_at ? Math.max(0, now.getTime() - new Date(active.pause_started_at).getTime()) / 1000 : 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000 - active.paused_seconds - currentPause));
}

export function remainingFocusSeconds(active: ActiveFocusState, now = new Date()): number | null {
  if (active.planned_seconds == null) return null;
  return Math.max(0, active.planned_seconds - elapsedFocusSeconds(active, now));
}

export function formatFocusDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

export function focusSessionsForDate(sessions: FocusSession[], date: Date): FocusSession[] {
  const target = toISODate(date);
  return sessions.filter((session) => toISODate(new Date(session.ended_at)) === target && !session.deleted_at);
}

export function totalFocusSeconds(sessions: FocusSession[]): number {
  return sessions.reduce((sum, session) => sum + Math.max(0, Number(session.duration_seconds ?? 0)), 0);
}

export interface FocusDailyTotal {
  date: string;
  label: string;
  total_seconds: number;
  session_count: number;
}

export function focusDailyTotals(sessions: FocusSession[], days = 7, now = new Date()): FocusDailyTotal[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index));
    const isoDate = toISODate(date);
    const matched = sessions.filter((session) => toISODate(new Date(session.ended_at)) === isoDate && !session.deleted_at);
    return {
      date: isoDate,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      total_seconds: totalFocusSeconds(matched),
      session_count: matched.length
    };
  });
}

export function focusModeLabel(mode: FocusTimerMode): string {
  return {
    stopwatch: "正计时",
    countdown: "倒计时",
    pomodoro: "番茄钟",
    lock: "锁机",
    rest: "休息"
  }[mode];
}
