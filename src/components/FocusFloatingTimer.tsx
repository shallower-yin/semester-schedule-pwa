import { useEffect, useRef, useState } from "react";
import { db, putRecordAndQueue } from "../db";
import {
  clearActiveFocus,
  elapsedFocusSeconds,
  FOCUS_STATE_CHANGED_EVENT,
  loadActiveFocus,
  loadPomodoroPlan,
  notifyFocusComplete,
  pomodoroRestKind,
  remainingFocusSeconds,
  saveActiveFocus,
  savePomodoroPlan,
  clearPomodoroPlan,
  type ActiveFocusState
} from "../lib/focus";
import { closeFocusSystemWindow, updateFocusSystemWindow } from "../lib/focusSystemWindow";
import { stopNativeFocusTimer } from "../lib/focusNativeTimer";
import { syncFields } from "../lib/identity";
import { isNativeApp } from "../lib/nativeApp";
import { showToast } from "../lib/toast";
import type { FocusSession, RestSession } from "../types";

interface FocusFloatingTimerProps {
  ownerId: string;
}

export function FocusFloatingTimer({ ownerId }: FocusFloatingTimerProps) {
  const [active, setActive] = useState<ActiveFocusState | null>(() => loadActiveFocus(ownerId));
  const [now, setNow] = useState(() => new Date());
  const completingRef = useRef(false);
  const ownerGenerationRef = useRef(0);

  useEffect(() => {
    // A completion may still be writing the previous owner's record when the
    // account changes.  Advance the generation so its finally-handler cannot
    // publish stale active state into the new owner's timer surface.
    ownerGenerationRef.current += 1;
    completingRef.current = false;
    const refresh = () => setActive(loadActiveFocus(ownerId));
    refresh();
    window.addEventListener(FOCUS_STATE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(() => {
      setNow(new Date());
      setActive(loadActiveFocus(ownerId));
    }, 1000);
    return () => {
      ownerGenerationRef.current += 1;
      window.removeEventListener(FOCUS_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(timer);
    };
  }, [ownerId]);

  const remaining = active ? remainingFocusSeconds(active, now) : null;
  const elapsed = active ? elapsedFocusSeconds(active, now) : 0;

  useEffect(() => {
    updateFocusSystemWindow(active, now);
  }, [active, now]);

  // Close only when a session actually ends. On native this avoids firing a hide() IPC every
  // second while idle, which would also tear down an overlay opened from another surface.
  useEffect(() => {
    if (!active) void closeFocusSystemWindow();
  }, [active]);

  useEffect(() => {
    if (!active || active.pause_started_at || active.planned_seconds == null || remaining !== 0 || completingRef.current) return;
    if (isNativeApp() && active.pomodoro_plan_id) return;
    const completionGeneration = ownerGenerationRef.current;
    completingRef.current = true;
    void completeExpiredFocus(
      ownerId,
      active,
      now,
      () => ownerGenerationRef.current === completionGeneration
    ).finally(() => {
      if (ownerGenerationRef.current !== completionGeneration) return;
      completingRef.current = false;
      setActive(loadActiveFocus(ownerId));
    });
  }, [active, now, ownerId, remaining]);

  return null;
}

export async function completeExpiredFocus(
  ownerId: string,
  active: ActiveFocusState,
  now = new Date(),
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  const latest = loadActiveFocus(ownerId);
  if (!latest || latest.started_at !== active.started_at || latest.pause_started_at || remainingFocusSeconds(latest, now) !== 0) return false;
  const duration = Math.max(1, elapsedFocusSeconds(latest, now));
  if (latest.mode === "rest") {
    const record: RestSession = {
      ...syncFields(undefined, ownerId),
      planned_seconds: latest.planned_seconds ?? duration,
      duration_seconds: duration,
      started_at: latest.started_at,
      ended_at: now.toISOString(),
      completed: true,
      interrupted: false,
      rest_kind: latest.pomodoro_rest_kind ?? "manual",
      pomodoro_plan_id: latest.pomodoro_plan_id ?? null,
      pomodoro_round: latest.pomodoro_round ?? null
    };
    await putRecordAndQueue("restSessions", record);
  } else {
    const record: FocusSession = {
      ...syncFields(undefined, ownerId),
      mode: latest.mode,
      task_title: latest.task_title,
      linked_event_id: latest.linked_event_id,
      planned_seconds: latest.planned_seconds,
      duration_seconds: duration,
      started_at: latest.started_at,
      ended_at: now.toISOString(),
      completed: true,
      interrupted: false,
      pomodoro_plan_id: latest.pomodoro_plan_id ?? null,
      pomodoro_round: latest.pomodoro_round ?? null
    };
    await putRecordAndQueue("focusSessions", record);
  }
  const settings = await db.focusSettings.filter((item) => item.user_id === ownerId && !item.deleted_at).last();
  const nextActive = nextPomodoroActiveAfterCompletion(ownerId, latest, now, {
    pomodoroMinutes: settings?.pomodoro_minutes ?? 25,
    shortBreakMinutes: settings?.short_break_minutes ?? 5,
    longBreakMinutes: settings?.long_break_minutes ?? 15,
    longBreakInterval: settings?.long_break_interval ?? 4,
    pomodoroRounds: settings?.pomodoro_rounds ?? 4
  });
  if (nextActive) {
    saveActiveFocus(ownerId, nextActive);
  } else {
    if (isCurrent()) await stopNativeFocusTimer(ownerId, latest.mode === "lock");
    clearActiveFocus(ownerId);
  }
  if (!isCurrent()) return true;
  notifyFocusComplete(latest.task_title, settings?.sound_enabled ?? true);
  showToast(
    nextActive?.mode === "rest"
      ? `“${latest.task_title}”专注结束，已自动开始${nextActive.task_title}。`
      : nextActive?.mode === "pomodoro"
        ? "休息结束，已自动开始下一轮番茄。"
        : latest.mode === "rest" ? "休息结束。" : `“${latest.task_title}”专注结束。`,
    "success"
  );
  return true;
}

function nextPomodoroActiveAfterCompletion(
  ownerId: string,
  active: ActiveFocusState,
  now: Date,
  settings: {
    pomodoroMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    longBreakInterval: number;
    pomodoroRounds: number;
  }
): ActiveFocusState | null {
  if (!active.pomodoro_plan_id) return null;
  const plan = loadPomodoroPlan(ownerId);
  if (active.mode === "pomodoro") {
    const round = active.pomodoro_round ?? 1;
    const total = active.pomodoro_total_rounds ?? settings.pomodoroRounds;
    savePomodoroPlan(ownerId, {
      id: active.pomodoro_plan_id,
      task_title: active.pomodoro_task_title ?? active.task_title,
      linked_event_id: active.linked_event_id,
      total_rounds: total,
      next_round: Math.min(total, round + 1),
      completed_rounds: round
    });
    if (active.pomodoro_auto_start_break === false) return null;
    const restKind = pomodoroRestKind({
      ...active,
      pomodoro_long_break_interval: active.pomodoro_long_break_interval ?? settings.longBreakInterval,
      pomodoro_total_rounds: total
    });
    return {
      ...active,
      mode: "rest",
      task_title: restKind === "pomodoro_long" ? "长休息" : "短休息",
      linked_event_id: null,
      planned_seconds: restKind === "pomodoro_long"
        ? active.pomodoro_long_break_seconds ?? settings.longBreakMinutes * 60
        : active.pomodoro_short_break_seconds ?? settings.shortBreakMinutes * 60,
      started_at: now.toISOString(),
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_total_rounds: total,
      pomodoro_rest_kind: restKind,
      pomodoro_task_title: active.pomodoro_task_title ?? active.task_title,
      pomodoro_focus_seconds: active.pomodoro_focus_seconds ?? active.planned_seconds ?? settings.pomodoroMinutes * 60
    };
  }
  if (active.mode === "rest") {
    const round = active.pomodoro_round ?? 1;
    const total = active.pomodoro_total_rounds ?? plan?.total_rounds ?? round;
    if (round >= total) {
      clearPomodoroPlan(ownerId);
      return null;
    }
    const nextRound = round + 1;
    const taskTitle = plan?.task_title ?? active.pomodoro_task_title ?? "番茄专注";
    const linkedEventId = plan?.linked_event_id ?? null;
    savePomodoroPlan(ownerId, {
      id: active.pomodoro_plan_id,
      task_title: taskTitle,
      linked_event_id: linkedEventId,
      total_rounds: total,
      next_round: nextRound,
      completed_rounds: round
    });
    return {
      ...active,
      mode: "pomodoro",
      task_title: taskTitle,
      linked_event_id: linkedEventId,
      planned_seconds: active.pomodoro_focus_seconds ?? settings.pomodoroMinutes * 60,
      started_at: now.toISOString(),
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_round: nextRound,
      pomodoro_total_rounds: total,
      pomodoro_rest_kind: null,
      pomodoro_task_title: taskTitle,
      pomodoro_focus_seconds: active.pomodoro_focus_seconds ?? settings.pomodoroMinutes * 60
    };
  }
  return null;
}
