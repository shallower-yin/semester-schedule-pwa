import type { FocusMode, FocusSession } from "../types";
import { toISODate } from "./date";

export interface ActiveFocusState {
  mode: FocusMode;
  task_title: string;
  linked_event_id: string | null;
  planned_seconds: number | null;
  started_at: string;
  paused_seconds: number;
  pause_started_at: string | null;
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

export function focusModeLabel(mode: FocusMode): string {
  return {
    stopwatch: "正计时",
    countdown: "倒计时",
    pomodoro: "番茄钟",
    lock: "锁机"
  }[mode];
}
