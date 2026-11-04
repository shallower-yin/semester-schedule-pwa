import { useEffect, useRef, useState } from "react";
import { completeFocusSession } from "../lib/focusCompletion";
import {
  claimFocusCompletion,
  elapsedFocusSeconds,
  FOCUS_STATE_CHANGED_EVENT,
  loadActiveFocus,
  notifyFocusComplete,
  remainingFocusSeconds,
  type ActiveFocusState
} from "../lib/focus";
import { closeFocusSystemWindow, updateFocusSystemWindow } from "../lib/focusSystemWindow";
import { stopNativeFocusTimer } from "../lib/focusNativeTimer";
import { isNativeApp } from "../lib/nativeApp";
import { showToast } from "../lib/toast";

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
  const releaseCompletion = claimFocusCompletion(ownerId, latest.started_at);
  if (!releaseCompletion) return false;
  try {
    const result = await completeFocusSession(ownerId, latest, { completed: true, interrupted: false, now });
    if (!result?.created) return false;
    const nextActive = result.nextActive;
    if (!isCurrent()) return true;
    if (!nextActive) await stopNativeFocusTimer(ownerId, latest.mode === "lock");
    notifyFocusComplete(latest.task_title, result.soundEnabled);
    showToast(
      nextActive?.mode === "rest"
        ? `“${latest.task_title}”专注结束，已自动开始${nextActive.task_title}。`
        : nextActive?.mode === "pomodoro"
          ? "休息结束，已自动开始下一轮番茄。"
          : latest.mode === "rest" ? "休息结束。" : `“${latest.task_title}”专注结束。`,
      "success"
    );
    return true;
  } finally {
    releaseCompletion();
  }
}
