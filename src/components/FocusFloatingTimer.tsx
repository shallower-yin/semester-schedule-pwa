import { useEffect, useRef, useState } from "react";
import { db, queueChange } from "../db";
import {
  clearActiveFocus,
  elapsedFocusSeconds,
  FOCUS_STATE_CHANGED_EVENT,
  loadActiveFocus,
  notifyFocusComplete,
  remainingFocusSeconds,
  type ActiveFocusState
} from "../lib/focus";
import { closeFocusSystemWindow, updateFocusSystemWindow } from "../lib/focusSystemWindow";
import { stopNativeFocusTimer } from "../lib/focusNativeTimer";
import { syncFields } from "../lib/identity";
import { showToast } from "../lib/toast";
import type { FocusSession, RestSession } from "../types";

interface FocusFloatingTimerProps {
  ownerId: string;
}

export function FocusFloatingTimer({ ownerId }: FocusFloatingTimerProps) {
  const [active, setActive] = useState<ActiveFocusState | null>(() => loadActiveFocus(ownerId));
  const [now, setNow] = useState(() => new Date());
  const completingRef = useRef(false);

  useEffect(() => {
    const refresh = () => setActive(loadActiveFocus(ownerId));
    refresh();
    window.addEventListener(FOCUS_STATE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(() => {
      setNow(new Date());
      setActive(loadActiveFocus(ownerId));
    }, 1000);
    return () => {
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
    completingRef.current = true;
    void completeExpiredFocus(ownerId, active, now).finally(() => {
      completingRef.current = false;
      setActive(loadActiveFocus(ownerId));
    });
  }, [active, now, ownerId, remaining]);

  return null;
}

export async function completeExpiredFocus(ownerId: string, active: ActiveFocusState, now = new Date()): Promise<boolean> {
  const latest = loadActiveFocus(ownerId);
  if (!latest || latest.started_at !== active.started_at || latest.pause_started_at || remainingFocusSeconds(latest, now) !== 0) return false;
  const duration = Math.max(1, elapsedFocusSeconds(latest, now));
  if (latest.mode === "rest") {
    const record: RestSession = {
      ...syncFields(),
      planned_seconds: latest.planned_seconds ?? duration,
      duration_seconds: duration,
      started_at: latest.started_at,
      ended_at: now.toISOString(),
      completed: true,
      interrupted: false
    };
    await db.restSessions.put(record);
    await queueChange("restSessions", record.id);
  } else {
    const record: FocusSession = {
      ...syncFields(),
      mode: latest.mode,
      task_title: latest.task_title,
      linked_event_id: latest.linked_event_id,
      planned_seconds: latest.planned_seconds,
      duration_seconds: duration,
      started_at: latest.started_at,
      ended_at: now.toISOString(),
      completed: true,
      interrupted: false
    };
    await db.focusSessions.put(record);
    await queueChange("focusSessions", record.id);
  }
  await stopNativeFocusTimer(latest.mode === "lock");
  clearActiveFocus(ownerId);
  const settings = await db.focusSettings.filter((item) => item.user_id === ownerId && !item.deleted_at).last();
  notifyFocusComplete(latest.task_title, settings?.sound_enabled ?? true);
  showToast(latest.mode === "rest" ? "休息结束。" : `“${latest.task_title}”专注结束。`, "success");
  return true;
}
