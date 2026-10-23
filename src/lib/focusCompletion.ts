import { db, putRecordAndQueue } from "../db";
import type { FocusSession, RestSession } from "../types";
import { syncFields } from "./identity";
import {
  clearActiveFocus, clearPomodoroPlan, elapsedFocusSeconds, loadActiveFocus,
  loadPomodoroPlan, pomodoroRestKind, saveActiveFocus, savePomodoroPlan,
  type ActiveFocusState
} from "./focus";

export interface FocusCompletionResult {
  created: boolean;
  record: FocusSession | RestSession;
  nextActive: ActiveFocusState | null;
  soundEnabled: boolean;
}

/**
 * IndexedDB read/write transactions serialize across tabs/connections. The
 * existing UUID record is the durable completion receipt; no schema/Web Locks
 * requirement and no localStorage mutation before a successful DB commit.
 */
export async function completeFocusSession(
  ownerId: string,
  active: ActiveFocusState,
  options: { completed: boolean; interrupted: boolean; now?: Date }
): Promise<FocusCompletionResult | null> {
  const latest = loadActiveFocus(ownerId);
  if (latest?.started_at !== active.started_at) return null;
  active = latest;
  const now = options.now ?? new Date();
  const saved = await db.transaction("rw", [db.focusSessions, db.restSessions, db.syncQueue, db.focusSettings], async () => {
    const existingFocus = await db.focusSessions.where("started_at").equals(active.started_at)
      .and((record) => record.user_id === ownerId).first();
    const existingRest = await db.restSessions.where("started_at").equals(active.started_at)
      .and((record) => record.user_id === ownerId).first();
    let record: FocusSession | RestSession | undefined = existingFocus ?? existingRest;
    const created = !record;
    if (!record) {
      const common = {
        ...syncFields(undefined, ownerId),
        planned_seconds: active.planned_seconds,
        duration_seconds: Math.max(1, elapsedFocusSeconds(active, now)),
        started_at: active.started_at,
        ended_at: now.toISOString(),
        completed: options.completed,
        interrupted: options.interrupted,
        pomodoro_plan_id: active.pomodoro_plan_id ?? null,
        pomodoro_round: active.pomodoro_round ?? null
      };
      if (active.mode === "rest") {
        record = { ...common, planned_seconds: active.planned_seconds ?? common.duration_seconds, rest_kind: active.pomodoro_rest_kind ?? "manual" };
        await putRecordAndQueue("restSessions", record);
      } else {
        record = { ...common, mode: active.mode, task_title: active.task_title, linked_event_id: active.linked_event_id };
        await putRecordAndQueue("focusSessions", record);
      }
    }
    const settings = await db.focusSettings.filter((item) => item.user_id === ownerId && !item.deleted_at).last();
    return { created, record, settings };
  });

  // A failed state publication can replay from the canonical committed end
  // time without inserting another row or forking the next stage's identity.
  let nextActive = loadActiveFocus(ownerId);
  if (nextActive?.started_at === active.started_at) {
    const canonicalActive: ActiveFocusState = "mode" in saved.record
      ? { ...active, mode: saved.record.mode, task_title: saved.record.task_title, linked_event_id: saved.record.linked_event_id }
      : { ...active, mode: "rest" };
    nextActive = saved.record.completed && !saved.record.deleted_at
      ? nextPomodoroActiveAfterCompletion(ownerId, canonicalActive, new Date(saved.record.ended_at), {
        pomodoroMinutes: saved.settings?.pomodoro_minutes ?? 25,
        shortBreakMinutes: saved.settings?.short_break_minutes ?? 5,
        longBreakMinutes: saved.settings?.long_break_minutes ?? 15,
        longBreakInterval: saved.settings?.long_break_interval ?? 4,
        pomodoroRounds: saved.settings?.pomodoro_rounds ?? 4
      })
      : null;
    if (nextActive) saveActiveFocus(ownerId, nextActive);
    else clearActiveFocus(ownerId);
  }
  return { created: saved.created, record: saved.record, nextActive, soundEnabled: saved.settings?.sound_enabled ?? true };
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
