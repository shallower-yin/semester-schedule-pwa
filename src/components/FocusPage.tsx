import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, Bell, CheckCircle2, Edit3, ListChecks, Link2, Maximize2, Pause, PictureInPicture2, Play, RotateCcw, Settings, Square, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import {
  elapsedFocusSeconds,
  clearActiveFocus,
  clearPomodoroPlan,
  FOCUS_STATE_CHANGED_EVENT,
  focusDailyTotals,
  focusModeLabel,
  focusSessionsForDate,
  formatFocusDuration,
  loadActiveFocus,
  loadPomodoroPlan,
  notifyFocusComplete,
  pomodoroRestKind,
  requestFocusNotificationPermission,
  saveActiveFocus,
  savePomodoroPlan,
  totalFocusSeconds,
  type ActiveFocusState,
  type PomodoroPlanState
} from "../lib/focus";
import { closeFocusSystemWindow, focusSystemWindowSupported, openFocusSystemWindow, updateFocusSystemWindow } from "../lib/focusSystemWindow";
import {
  clearNativeFocusTransitions,
  enterNativeLockTask,
  pauseNativeFocusTimer,
  readNativeFocusTimer,
  readNativeFocusTransitions,
  resumeNativeFocusTimer,
  startNativeFocusTimer,
  stopNativeFocusTimer,
  type NativeFocusTransition,
  type NativeTimerState
} from "../lib/focusNativeTimer";
import { hardDeleteLocalRecord, hardDeleteLocalRecords } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { isNativeApp } from "../lib/nativeApp";
import { showToast } from "../lib/toast";
import type { EventItem, FocusMode, FocusSession, FocusSettings, FocusTimerMode, RestSession } from "../types";
import { Modal } from "./Modal";
import { FocusAudioPlayer } from "./FocusAudioPlayer";
import { FocusFullscreen, enterImmersiveFullscreen, exitImmersiveFullscreen, lockOrientation } from "./FocusFullscreen";

interface FocusPageProps {
  ownerId: string;
}

const DEFAULT_SETTINGS = {
  pomodoro_minutes: 25,
  pomodoro_rounds: 4,
  short_break_minutes: 5,
  long_break_minutes: 15,
  long_break_interval: 4,
  auto_start_break: true,
  countdown_minutes: 30,
  daily_goal_minutes: 120,
  sound_enabled: true
};

export function FocusPage({ ownerId }: FocusPageProps) {
  const storedSettings = useLiveQuery(
    async () => {
      const items = await db.focusSettings.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
      return items.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
    },
    [ownerId]
  );
  const sessions = useLiveQuery(
    () => db.focusSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
    [ownerId]
  ) ?? [];
  const restSessions = useLiveQuery(
    () => db.restSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
    [ownerId]
  ) ?? [];
  const events = useLiveQuery(
    () => db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
    [ownerId]
  ) ?? [];
  const [mode, setMode] = useState<FocusTimerMode>("pomodoro");
  const [pomodoroPlan, setPomodoroPlan] = useState<PomodoroPlanState | null>(() => loadPomodoroPlan(ownerId));
  const [taskTitle, setTaskTitle] = useState("");
  const [linkedEventId, setLinkedEventId] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [active, setActive] = useState<ActiveFocusState | null>(() => loadActiveFocus(ownerId));
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState("");
  const [sessionToEdit, setSessionToEdit] = useState<FocusSession | null>(null);
  const [managingRecords, setManagingRecords] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [systemWindowOpen, setSystemWindowOpen] = useState(false);
  const [nativeElapsed, setNativeElapsed] = useState<number | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("week");

  const effectiveSettings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      ...(storedSettings ?? settingsDraft),
      pomodoro_rounds: storedSettings?.pomodoro_rounds ?? settingsDraft.pomodoro_rounds ?? DEFAULT_SETTINGS.pomodoro_rounds
    }),
    [settingsDraft, storedSettings]
  );
  const todaySessions = useMemo(() => focusSessionsForDate(sessions, new Date()), [sessions]);
  const todaySeconds = totalFocusSeconds(todaySessions);
  const weekSessions = useMemo(() => {
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    return sessions.filter((session) => new Date(session.ended_at) >= monday);
  }, [sessions]);
  const weekSeconds = totalFocusSeconds(weekSessions);
  const dailyTotals = useMemo(() => focusDailyTotals(sessions, 7, new Date()), [sessions]);
  const maxDailySeconds = Math.max(1, ...dailyTotals.map((item) => item.total_seconds));
  const todayBreakdown = useMemo(() => focusBreakdown(todaySessions, events), [events, todaySessions]);
  const weekBreakdown = useMemo(() => focusBreakdown(weekSessions, events), [events, weekSessions]);
  const elapsed = active ? nativeElapsed ?? elapsedFocusSeconds(active, now) : 0;
  const remaining = active?.planned_seconds == null ? null : Math.max(0, active.planned_seconds - elapsed);
  const displaySeconds = active ? remaining ?? elapsed : plannedSecondsForMode(mode, effectiveSettings);
  const progress = active?.planned_seconds ? Math.min(1, elapsed / active.planned_seconds) : 0;
  const recentSessions = useMemo(
    () => sessions.slice().sort((left, right) => right.ended_at.localeCompare(left.ended_at)).slice(0, 20),
    [sessions]
  );
  const recentRestSessions = useMemo(
    () => restSessions.slice().sort((left, right) => right.ended_at.localeCompare(left.ended_at)).slice(0, 10),
    [restSessions]
  );
  const periodFocusSessions = useMemo(() => recordsForPeriod(sessions, statsPeriod, now), [now, sessions, statsPeriod]);
  const periodRestSessions = useMemo(() => recordsForPeriod(restSessions, statsPeriod, now), [now, restSessions, statsPeriod]);
  const periodFocusSeconds = totalFocusSeconds(periodFocusSessions);
  const periodRestSeconds = totalRestSeconds(periodRestSessions);

  useEffect(() => {
    if (storedSettings) {
      setSettingsDraft({
        pomodoro_minutes: storedSettings.pomodoro_minutes,
        pomodoro_rounds: storedSettings.pomodoro_rounds ?? 4,
        short_break_minutes: storedSettings.short_break_minutes,
        long_break_minutes: storedSettings.long_break_minutes ?? 15,
        long_break_interval: storedSettings.long_break_interval ?? 4,
        auto_start_break: storedSettings.auto_start_break !== false,
        countdown_minutes: storedSettings.countdown_minutes,
        daily_goal_minutes: storedSettings.daily_goal_minutes,
        sound_enabled: storedSettings.sound_enabled
      });
    }
  }, [storedSettings?.id, storedSettings?.updated_at]);

  useEffect(() => {
    setActive(loadActiveFocus(ownerId));
    setPomodoroPlan(loadPomodoroPlan(ownerId));
    const refresh = () => {
      setActive(loadActiveFocus(ownerId));
      setPomodoroPlan(loadPomodoroPlan(ownerId));
    };
    window.addEventListener(FOCUS_STATE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FOCUS_STATE_CHANGED_EVENT, refresh);
  }, [ownerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!active) {
      setNativeElapsed(null);
      return;
    }
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const transitions = await readNativeFocusTransitions(ownerId);
        if (transitions.length) {
          const nextPlan = await persistNativeTransitions(ownerId, transitions);
          await clearNativeFocusTransitions(transitions.map((item) => item.id));
          if (!cancelled && nextPlan !== undefined) setPomodoroPlan(nextPlan);
        }
        let state = await readNativeFocusTimer(ownerId);
        if (!state) {
          await startNativeFocusTimer(ownerId, active);
          state = await readNativeFocusTimer(ownerId);
        }
        if (cancelled || !state) return;
        if (!state.active && active.pomodoro_plan_id) {
          clearActiveFocus(ownerId);
          setActive(null);
          setNativeElapsed(null);
          return;
        }
        if (state.active) {
          const next = activeFocusFromNativeState(active, state);
          if (!sameActiveStage(active, next)) {
            saveActiveFocus(ownerId, next);
            setActive(next);
          }
          setNativeElapsed(state.elapsedSeconds);
        }
      } catch {
        if (!cancelled) setNativeElapsed(null);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active?.started_at, ownerId]);

  useEffect(() => {
    if (!active?.planned_seconds || remaining == null || remaining > 0 || active.pause_started_at) return;
    if (isNativeApp() && active.pomodoro_plan_id) return;
    void finishFocus(true, false);
  }, [active?.started_at, active?.pause_started_at, remaining]);



  useEffect(() => {
    if (active?.mode !== "lock") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [active?.mode]);

  const selectedEvent = events.find((event) => event.id === linkedEventId);

  async function startFocus() {
    const isRest = mode === "rest";
    let plan = mode === "pomodoro" ? pomodoroPlan : null;
    if (mode === "pomodoro" && !plan) {
      plan = {
        id: crypto.randomUUID(),
        task_title: taskTitle.trim() || selectedEvent?.title || "番茄专注",
        linked_event_id: linkedEventId || null,
        total_rounds: Math.max(1, effectiveSettings.pomodoro_rounds),
        next_round: 1,
        completed_rounds: 0
      };
      savePomodoroPlan(ownerId, plan);
      setPomodoroPlan(plan);
    }
    const title = isRest ? "休息" : plan?.task_title || taskTitle.trim() || selectedEvent?.title || focusModeLabel(mode);
    const plannedSeconds = plannedSecondsForMode(mode, effectiveSettings);
    const next: ActiveFocusState = {
      mode,
      task_title: title,
      linked_event_id: isRest ? null : (plan?.linked_event_id ?? linkedEventId) || null,
      planned_seconds: mode === "stopwatch" || mode === "lock" ? null : plannedSeconds,
      started_at: new Date().toISOString(),
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_plan_id: plan?.id ?? null,
      pomodoro_round: plan?.next_round ?? null,
      pomodoro_total_rounds: plan?.total_rounds ?? null,
      pomodoro_short_break_seconds: plan ? effectiveSettings.short_break_minutes * 60 : null,
      pomodoro_long_break_seconds: plan ? effectiveSettings.long_break_minutes * 60 : null,
      pomodoro_long_break_interval: plan ? effectiveSettings.long_break_interval : null,
      pomodoro_auto_start_break: plan ? effectiveSettings.auto_start_break : false,
      pomodoro_rest_kind: null,
      sound_enabled: effectiveSettings.sound_enabled
    };
    setActive(next);
    saveActiveFocus(ownerId, next);
    try {
      const elapsedSeconds = await startNativeFocusTimer(ownerId, next);
      if (elapsedSeconds != null) setNativeElapsed(elapsedSeconds);
    } catch {
      setNativeElapsed(null);
    }
    // 系统小窗（原生悬浮窗 / 画中画）只在用户点击“系统小窗”时打开，开始专注不再自动弹出。
    if (effectiveSettings.sound_enabled) requestFocusNotificationPermission();
    if (mode === "lock") {
      void enterImmersiveFullscreen();
      try {
        const pinned = await enterNativeLockTask();
        if (!pinned) showToast("系统未进入屏幕固定，请确认系统弹窗。", "info");
      } catch {
        showToast("无法启动系统屏幕固定，请在安卓设置中启用“固定屏幕”。", "error");
      }
    }
    setMessage("");
  }

  async function openSystemTimer(current = active, interactive = false) {
    if (!current) return;
    try {
      await openFocusSystemWindow(current, new Date(), interactive);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法打开系统倒计时小窗。", "error");
    }
  }

  function toggleSystemWindow() {
    if (!active) return;
    if (systemWindowOpen) {
      void closeFocusSystemWindow();
      setSystemWindowOpen(false);
    } else {
      void openSystemTimer(active, true).then(() => setSystemWindowOpen(true)).catch(() => {});
    }
  }

  function enterFullscreen() {
    setShowFullscreen(true);
    void enterImmersiveFullscreen();
  }

  function exitFullscreen() {
    setShowFullscreen(false);
    void exitImmersiveFullscreen();
    void lockOrientation("auto");
  }

  function finishActiveFocus() {
    if (!active) return;
    const completed = active.planned_seconds == null || elapsed >= active.planned_seconds;
    const interrupted = Boolean(active.planned_seconds && elapsed < active.planned_seconds);
    void finishFocus(completed, interrupted);
  }

  function pauseOrResume() {
    if (!active) return;
    const current = new Date();
    if (active.pause_started_at) {
      const pausedFor = Math.max(0, Math.floor((current.getTime() - new Date(active.pause_started_at).getTime()) / 1000));
      const next = { ...active, paused_seconds: active.paused_seconds + pausedFor, pause_started_at: null };
      setActive(next);
      saveActiveFocus(ownerId, next);
      void resumeNativeFocusTimer().then((seconds) => seconds != null && setNativeElapsed(seconds));
      updateFocusSystemWindow(next);
    } else {
      const next = { ...active, pause_started_at: current.toISOString() };
      setActive(next);
      saveActiveFocus(ownerId, next);
      void pauseNativeFocusTimer().then((seconds) => seconds != null && setNativeElapsed(seconds));
      updateFocusSystemWindow(next);
    }
  }

  async function finishFocus(completed: boolean, interrupted: boolean) {
    if (!active) return;
    const endedAt = new Date();
    const duration = Math.max(1, elapsedFocusSeconds(active, endedAt));
    if (active.mode === "rest") {
      const record: RestSession = {
        ...syncFields(),
        planned_seconds: active.planned_seconds ?? effectiveSettings.short_break_minutes * 60,
        duration_seconds: duration,
        started_at: active.started_at,
        ended_at: endedAt.toISOString(),
        completed,
        interrupted,
        rest_kind: active.pomodoro_rest_kind ?? "manual",
        pomodoro_plan_id: active.pomodoro_plan_id ?? null,
        pomodoro_round: active.pomodoro_round ?? null
      };
      await db.restSessions.put(record);
      await queueChange("restSessions", record.id);
    } else {
      const record: FocusSession = {
        ...syncFields(),
        mode: active.mode,
        task_title: active.task_title,
        linked_event_id: active.linked_event_id,
        planned_seconds: active.planned_seconds,
        duration_seconds: duration,
        started_at: active.started_at,
        ended_at: endedAt.toISOString(),
        completed,
        interrupted,
        pomodoro_plan_id: active.pomodoro_plan_id ?? null,
        pomodoro_round: active.pomodoro_round ?? null
      };
      await db.focusSessions.put(record);
      await queueChange("focusSessions", record.id);
    }
    await stopNativeFocusTimer(active.mode === "lock");
    let nextActive: ActiveFocusState | null = null;
    if (completed && active.mode === "pomodoro" && active.pomodoro_plan_id) {
      const round = active.pomodoro_round ?? 1;
      const total = active.pomodoro_total_rounds ?? effectiveSettings.pomodoro_rounds;
      const updatedPlan: PomodoroPlanState = {
        id: active.pomodoro_plan_id,
        task_title: active.task_title,
        linked_event_id: active.linked_event_id,
        total_rounds: total,
        next_round: Math.min(total, round + 1),
        completed_rounds: round
      };
      savePomodoroPlan(ownerId, updatedPlan);
      setPomodoroPlan(updatedPlan);
      if (active.pomodoro_auto_start_break) {
        const restKind = pomodoroRestKind(active);
        const restSeconds = restKind === "pomodoro_long"
          ? active.pomodoro_long_break_seconds ?? effectiveSettings.long_break_minutes * 60
          : active.pomodoro_short_break_seconds ?? effectiveSettings.short_break_minutes * 60;
        nextActive = {
          ...active,
          mode: "rest",
          task_title: restKind === "pomodoro_long" ? "长休息" : "短休息",
          linked_event_id: null,
          planned_seconds: restSeconds,
          started_at: endedAt.toISOString(),
          paused_seconds: 0,
          pause_started_at: null,
          pomodoro_rest_kind: restKind
        };
      }
    } else if (completed && active.mode === "rest" && active.pomodoro_plan_id) {
      const round = active.pomodoro_round ?? 1;
      const total = active.pomodoro_total_rounds ?? pomodoroPlan?.total_rounds ?? round;
      if (round >= total) {
        clearPomodoroPlan(ownerId);
        setPomodoroPlan(null);
      } else {
        const updatedPlan: PomodoroPlanState = {
          id: active.pomodoro_plan_id,
          task_title: pomodoroPlan?.task_title ?? "番茄专注",
          linked_event_id: pomodoroPlan?.linked_event_id ?? null,
          total_rounds: total,
          next_round: round + 1,
          completed_rounds: round
        };
        savePomodoroPlan(ownerId, updatedPlan);
        setPomodoroPlan(updatedPlan);
      }
    }
    if (nextActive) {
      saveActiveFocus(ownerId, nextActive);
      setActive(nextActive);
      try {
        const nativeSeconds = await startNativeFocusTimer(ownerId, nextActive);
        setNativeElapsed(nativeSeconds);
      } catch {
        setNativeElapsed(null);
      }
    } else {
      clearActiveFocus(ownerId);
      setActive(null);
    }
    void closeFocusSystemWindow();
    void exitImmersiveFullscreen();
    void lockOrientation("auto");
    setShowFullscreen(false);
    setSystemWindowOpen(false);
    setTaskTitle("");
    setLinkedEventId("");
    if (!nextActive) setNativeElapsed(null);
    const kind = active.mode === "rest" ? "休息" : "专注";
    const resultMessage = completed ? `已完成 ${formatFocusDuration(duration)} ${kind}。` : `已保存 ${formatFocusDuration(duration)} ${kind}记录。`;
    setMessage(resultMessage);
    showToast(resultMessage, "success");
    if (completed) notifyFocusComplete(active.task_title, effectiveSettings.sound_enabled);
  }

  function discardFocus() {
    if (!active || !window.confirm(`放弃当前${active.mode === "rest" ? "休息" : "专注"}？不会保存本次记录。`)) return;
    void stopNativeFocusTimer(active.mode === "lock");
    clearActiveFocus(ownerId);
    void closeFocusSystemWindow();
    void exitImmersiveFullscreen();
    void lockOrientation("auto");
    setActive(null);
    setShowFullscreen(false);
    setSystemWindowOpen(false);
    setNativeElapsed(null);
    setMessage("已放弃当前专注。");
    showToast("已放弃当前专注。", "info");
  }

  async function saveSettings() {
    const record: FocusSettings = {
      ...syncFields(storedSettings),
      ...settingsDraft
    };
    await db.focusSettings.put(record);
    await queueChange("focusSettings", record.id);
    setMessage("专注设置已保存。");
    showToast("专注设置已保存。", "success");
  }

  async function deleteSession(session: FocusSession) {
    if (!window.confirm(`确定彻底删除专注记录“${session.task_title || focusModeLabel(session.mode)}”吗？此操作无法恢复。`)) return;
    await hardDeleteLocalRecord("focusSessions", session.id);
    setMessage("专注记录已彻底删除。");
    showToast("专注记录已彻底删除。", "success");
  }

  async function deleteRestSession(session: RestSession) {
    if (!window.confirm(`确定彻底删除这条 ${formatFocusDuration(session.duration_seconds)} 的休息记录吗？此操作无法恢复。`)) return;
    await hardDeleteLocalRecord("restSessions", session.id);
    setMessage("休息记录已彻底删除。");
    showToast("休息记录已彻底删除。", "success");
  }

  function toggleRecordSelection(id: string) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelectedSessions() {
    const ids = Array.from(selectedSessionIds);
    if (!ids.length || !window.confirm(`彻底删除选中的 ${ids.length} 条专注记录？此操作无法恢复。`)) return;
    await hardDeleteLocalRecords("focusSessions", ids);
    setSelectedSessionIds(new Set());
    setManagingRecords(false);
    setMessage(`已彻底删除 ${ids.length} 条专注记录。`);
    showToast(`已删除 ${ids.length} 条专注记录。`, "success");
  }

  return (
    <section className="focus-page">
      <div className="page-heading focus-heading">
        <div>
          <h1>专注</h1>
          <p>专注与休息分开记录；休息不会计入专注目标和专注历史。</p>
        </div>
        <div className="focus-stats">
          <span><strong>{formatFocusDuration(todaySeconds)}</strong><small>今日</small></span>
          <span><strong>{formatFocusDuration(weekSeconds)}</strong><small>本周</small></span>
          <span><strong>{todaySessions.length}</strong><small>今日次数</small></span>
        </div>
      </div>

      <div className="focus-layout">
        <div className="focus-main-column">
        <section className="focus-panel">
          <div className="focus-mode-tabs">
            {(["stopwatch", "pomodoro", "rest", "lock"] as FocusTimerMode[]).map((item) => (
              <button key={item} className={mode === item ? "active" : ""} disabled={Boolean(active)} onClick={() => setMode(item)}>
                {focusModeLabel(item)}
              </button>
            ))}
          </div>

          {(mode !== "rest" || active) && active?.mode !== "rest" && <>
            <label className="focus-linked-task">
              <Link2 size={17} />
              <select value={linkedEventId} disabled={Boolean(active)} onChange={(event) => setLinkedEventId(event.target.value)}>
                <option value="">关联任务：无</option>
                {events.slice(0, 80).map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
            </label>
            <input
              className="focus-task-input"
              placeholder="专注任务，例如：复习高数"
              value={taskTitle}
              disabled={Boolean(active)}
              onChange={(event) => setTaskTitle(event.target.value)}
            />
          </>}

          <div className="focus-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}>
            <div>
              <Target size={34} />
              <strong>{formatFocusDuration(displaySeconds)}</strong>
              <span>{active ? active.task_title : focusModeLabel(mode)}</span>
            </div>
          </div>

          {!active ? (
            <button className="button primary focus-start-button" onClick={() => void startFocus()}><Play size={18} />{mode === "rest" ? "开始休息" : "开始专注"}</button>
          ) : (
            <div className="focus-actions">
              <button className="button secondary" onClick={enterFullscreen} title="进入全屏专注">
                <Maximize2 size={17} />全屏
              </button>
              <button className="button secondary" disabled={!focusSystemWindowSupported()} onClick={toggleSystemWindow} title={systemWindowOpen ? "关闭悬浮小窗" : "在其他应用上方显示倒计时"}>
                <PictureInPicture2 size={17} />{systemWindowOpen ? "关闭小窗" : "系统小窗"}
              </button>
              <button className="button secondary" onClick={pauseOrResume}>{active.pause_started_at ? <Play size={17} /> : <Pause size={17} />}{active.pause_started_at ? "继续" : "暂停"}</button>
              <button className="button primary" onClick={finishActiveFocus}><CheckCircle2 size={17} />结束并保存</button>
              <button className="button danger-button" onClick={discardFocus}><Square size={16} />放弃</button>
            </div>
          )}
          {message && <p className="status-message">{message}</p>}
        </section>

        <FocusAudioPlayer />
        </div>

        <aside className="focus-side">
          <section>
            <h2><Settings size={18} />番茄、休息与目标设置</h2>
            <div className="focus-settings-grid">
              <label><span>番茄</span><input aria-label="番茄分钟" type="number" min={1} max={240} value={settingsDraft.pomodoro_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, pomodoro_minutes: Number(event.target.value) })} /><small>分钟</small></label>
              <label><span>番茄个数</span><input aria-label="番茄个数" type="number" min={1} max={24} value={settingsDraft.pomodoro_rounds} onChange={(event) => setSettingsDraft({ ...settingsDraft, pomodoro_rounds: Number(event.target.value) })} /><small>个</small></label>
              <label><span>短休息</span><input aria-label="短休息分钟" type="number" min={1} max={120} value={settingsDraft.short_break_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, short_break_minutes: Number(event.target.value) })} /><small>分钟</small></label>
              <label><span>长休息</span><input aria-label="长休息分钟" type="number" min={1} max={240} value={settingsDraft.long_break_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, long_break_minutes: Number(event.target.value) })} /><small>分钟</small></label>
              <label><span>长休息间隔</span><input aria-label="长休息间隔" type="number" min={1} max={24} value={settingsDraft.long_break_interval} onChange={(event) => setSettingsDraft({ ...settingsDraft, long_break_interval: Number(event.target.value) })} /><small>轮</small></label>
              <label><span>每日目标</span><input aria-label="每日目标分钟" type="number" min={1} max={1440} value={settingsDraft.daily_goal_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, daily_goal_minutes: Number(event.target.value) })} /><small>分钟</small></label>
            </div>
            <label className="checkbox-label focus-sound"><input type="checkbox" checked={settingsDraft.auto_start_break} onChange={(event) => setSettingsDraft({ ...settingsDraft, auto_start_break: event.target.checked })} /><Pause size={16} />专注结束后自动开始休息</label>
            <label className="checkbox-label focus-sound"><input type="checkbox" checked={settingsDraft.sound_enabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, sound_enabled: event.target.checked })} /><Bell size={16} />结束提醒</label>
            <button className="button secondary compact" onClick={() => void saveSettings()}><RotateCcw size={16} />保存设置</button>
          </section>

          <section>
            <div className="focus-period-heading">
              <h2><BarChart3 size={18} />专注 / 休息统计</h2>
              <div className="focus-period-tabs" aria-label="统计周期">
                {(["day", "week", "month"] as StatsPeriod[]).map((period) => (
                  <button key={period} className={statsPeriod === period ? "active" : ""} onClick={() => setStatsPeriod(period)}>{statsPeriodLabel(period)}</button>
                ))}
              </div>
            </div>
            <div className="focus-period-stats">
              <span><small>专注时长</small><strong>{formatFocusDuration(periodFocusSeconds)}</strong></span>
              <span><small>专注次数</small><strong>{periodFocusSessions.length}</strong></span>
              <span className="rest"><small>休息时长</small><strong>{formatFocusDuration(periodRestSeconds)}</strong></span>
              <span className="rest"><small>休息次数</small><strong>{periodRestSessions.length}</strong></span>
            </div>
          </section>

          <section>
            <h2><BarChart3 size={18} />近 7 日专注趋势</h2>
            <div className="focus-chart">
              {dailyTotals.map((item) => (
                <div key={item.date} className="focus-chart-bar">
                  <div className="focus-chart-track">
                    <span style={{ height: `${Math.max(6, (item.total_seconds / maxDailySeconds) * 100)}%` }} />
                  </div>
                  <strong>{formatFocusDuration(item.total_seconds)}</strong>
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2><ListChecks size={18} />专注内容</h2>
            <div className="focus-breakdown-grid">
              <FocusBreakdownList title="今日" items={todayBreakdown} />
              <FocusBreakdownList title="本周" items={weekBreakdown} />
            </div>
          </section>

        </aside>
      </div>

      <section className="focus-record-section focus-record-section-wide">
        <div className="focus-section-heading">
          <div><h2><ListChecks size={18} />最近记录</h2><p>显示最近 20 条，可进入管理模式批量选择。</p></div>
          <div className="focus-record-manage-actions">
            {managingRecords ? <>
              <label className="checkbox-label"><input type="checkbox" checked={recentSessions.length > 0 && selectedSessionIds.size === recentSessions.length} onChange={(event) => setSelectedSessionIds(event.target.checked ? new Set(recentSessions.map((session) => session.id)) : new Set())} />全选</label>
              <button className="button danger-button compact" disabled={!selectedSessionIds.size} onClick={() => void deleteSelectedSessions()}><Trash2 size={14} />删除所选（{selectedSessionIds.size}）</button>
              <button className="button secondary compact" onClick={() => { setManagingRecords(false); setSelectedSessionIds(new Set()); }}>取消</button>
            </> : <button className="button secondary compact" onClick={() => setManagingRecords(true)} disabled={!recentSessions.length}>管理记录</button>}
          </div>
        </div>
        <div className="focus-record-list focus-record-grid">
          {recentSessions.map((session) => (
            <article key={session.id} className={selectedSessionIds.has(session.id) ? "selected" : ""}>
              {managingRecords && <label className="focus-record-selector" aria-label={`选择${session.task_title || focusModeLabel(session.mode)}`}><input type="checkbox" checked={selectedSessionIds.has(session.id)} onChange={() => toggleRecordSelection(session.id)} /></label>}
              <strong>{session.task_title || focusModeLabel(session.mode)}</strong>
              <span>{focusModeLabel(session.mode)} · {formatFocusDuration(session.duration_seconds)} · {new Date(session.ended_at).toLocaleString()}</span>
              {!managingRecords && <div className="focus-record-actions">
                <button className="button secondary compact" onClick={() => setSessionToEdit(session)}><Edit3 size={14} />编辑</button>
                <button className="button danger-button compact" onClick={() => void deleteSession(session)}><Trash2 size={14} />彻底删除</button>
              </div>}
            </article>
          ))}
          {!recentSessions.length && <p>还没有专注记录。</p>}
        </div>
      </section>

      <section className="focus-record-section focus-record-section-wide rest-record-section">
        <div className="focus-section-heading">
          <div><h2><Pause size={18} />最近休息</h2><p>独立保存，不计入任何专注时长、次数或每日目标。</p></div>
        </div>
        <div className="focus-record-list focus-record-grid">
          {recentRestSessions.map((session) => (
            <article key={session.id}>
              <strong>休息 {formatFocusDuration(session.duration_seconds)}</strong>
              <span>{session.completed ? "已完成" : "提前结束"} · {new Date(session.ended_at).toLocaleString()}</span>
              <div className="focus-record-actions">
                <button className="button danger-button compact" onClick={() => void deleteRestSession(session)}><Trash2 size={14} />彻底删除</button>
              </div>
            </article>
          ))}
          {!recentRestSessions.length && <p>还没有休息记录。</p>}
        </div>
      </section>

      {showFullscreen && active && active.mode !== "lock" && (
        <FocusFullscreen
          active={active}
          displaySeconds={displaySeconds}
          progress={progress}
          paused={Boolean(active.pause_started_at)}
          now={now}
          systemWindowSupported={focusSystemWindowSupported()}
          onPauseResume={pauseOrResume}
          onFinish={finishActiveFocus}
          onDiscard={discardFocus}
          onExit={exitFullscreen}
          onToggleSystemWindow={toggleSystemWindow}
          systemWindowOpen={systemWindowOpen}
        />
      )}
      {active?.mode === "lock" && (
        <div className="focus-lock-overlay" role="dialog" aria-modal="true" aria-label="锁机专注">
          <div className="focus-lock-card focus-lock-minimal">
            <strong aria-label={`已专注 ${formatFocusDuration(elapsed)}`}>{formatFocusDuration(elapsed)}</strong>
            <button className="button primary" onClick={() => void finishFocus(true, false)}>结束</button>
          </div>
        </div>
      )}
      {sessionToEdit && (
        <FocusSessionDialog
          session={sessionToEdit}
          events={events}
          onClose={() => setSessionToEdit(null)}
          onSaved={(text) => {
            setSessionToEdit(null);
            setMessage(text);
          }}
        />
      )}
    </section>
  );
}

function activeFocusFromNativeState(current: ActiveFocusState, state: NativeTimerState): ActiveFocusState {
  const mode: FocusTimerMode = state.mode === "rest"
    ? "rest"
    : state.mode === "stopwatch" || state.mode === "countdown" || state.mode === "lock"
      ? state.mode
      : "pomodoro";
  return {
    ...current,
    mode,
    task_title: state.title || current.task_title,
    linked_event_id: mode === "rest" ? null : state.linkedEventId || null,
    planned_seconds: state.plannedSeconds > 0 ? state.plannedSeconds : null,
    started_at: state.startedAt > 0 ? new Date(state.startedAt).toISOString() : current.started_at,
    pause_started_at: state.paused ? current.pause_started_at ?? new Date().toISOString() : null,
    pomodoro_plan_id: state.pomodoroPlanId || null,
    pomodoro_round: state.pomodoroRound || null,
    pomodoro_total_rounds: state.pomodoroTotalRounds || null,
    pomodoro_short_break_seconds: state.pomodoroShortBreakSeconds || null,
    pomodoro_long_break_seconds: state.pomodoroLongBreakSeconds || null,
    pomodoro_long_break_interval: state.pomodoroLongBreakInterval || null,
    pomodoro_auto_start_break: state.pomodoroAutoStartBreak,
    pomodoro_rest_kind: state.pomodoroRestKind === "pomodoro_long"
      ? "pomodoro_long"
      : state.pomodoroRestKind === "pomodoro_short"
        ? "pomodoro_short"
        : null
  };
}

function sameActiveStage(left: ActiveFocusState, right: ActiveFocusState): boolean {
  return left.mode === right.mode
    && left.task_title === right.task_title
    && left.started_at === right.started_at
    && left.planned_seconds === right.planned_seconds
    && Boolean(left.pause_started_at) === Boolean(right.pause_started_at)
    && left.pomodoro_round === right.pomodoro_round
    && left.pomodoro_rest_kind === right.pomodoro_rest_kind;
}

async function persistNativeTransitions(
  ownerId: string,
  transitions: NativeFocusTransition[]
): Promise<PomodoroPlanState | null | undefined> {
  if (!transitions.length) return undefined;
  let plan = loadPomodoroPlan(ownerId);
  for (const transition of transitions) {
    const common = {
      ...syncFields(),
      id: transition.id,
      user_id: ownerId,
      planned_seconds: transition.plannedSeconds,
      duration_seconds: Math.max(1, transition.durationSeconds),
      started_at: new Date(transition.startedAt).toISOString(),
      ended_at: new Date(transition.endedAt).toISOString(),
      completed: true,
      interrupted: false,
      pomodoro_plan_id: transition.pomodoroPlanId || null,
      pomodoro_round: transition.pomodoroRound || null
    };
    if (transition.kind === "rest") {
      const record: RestSession = {
        ...common,
        rest_kind: transition.restKind || "manual"
      };
      await db.restSessions.put(record);
      await queueChange("restSessions", record.id);
    } else {
      const record: FocusSession = {
        ...common,
        mode: "pomodoro",
        task_title: transition.title || plan?.task_title || "番茄专注",
        linked_event_id: transition.linkedEventId || null
      };
      await db.focusSessions.put(record);
      await queueChange("focusSessions", record.id);
    }

    const round = Math.max(1, transition.pomodoroRound || 1);
    const total = Math.max(round, transition.pomodoroTotalRounds || plan?.total_rounds || round);
    if (transition.kind === "focus") {
      plan = {
        id: transition.pomodoroPlanId,
        task_title: transition.title || plan?.task_title || "番茄专注",
        linked_event_id: transition.linkedEventId || plan?.linked_event_id || null,
        total_rounds: total,
        next_round: Math.min(total, round + 1),
        completed_rounds: round
      };
      savePomodoroPlan(ownerId, plan);
    } else if (round >= total) {
      plan = null;
      clearPomodoroPlan(ownerId);
    } else if (plan) {
      plan = { ...plan, next_round: round + 1, completed_rounds: round };
      savePomodoroPlan(ownerId, plan);
    }
  }
  return plan;
}

interface FocusBreakdownItem {
  title: string;
  seconds: number;
  count: number;
}

function focusBreakdown(sessions: FocusSession[], events: EventItem[]): FocusBreakdownItem[] {
  const eventTitleMap = new Map(events.map((event) => [event.id, event.title]));
  const map = new Map<string, FocusBreakdownItem>();
  for (const session of sessions) {
    const title = session.linked_event_id
      ? eventTitleMap.get(session.linked_event_id) ?? session.task_title ?? "已删除任务"
      : session.task_title || focusModeLabel(session.mode);
    const key = title.trim() || "未命名专注";
    const item = map.get(key) ?? { title: key, seconds: 0, count: 0 };
    item.seconds += session.duration_seconds;
    item.count += 1;
    map.set(key, item);
  }
  return Array.from(map.values())
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 6);
}

function FocusBreakdownList({ title, items }: { title: string; items: FocusBreakdownItem[] }) {
  return (
    <div className="focus-breakdown-list">
      <strong>{title}</strong>
      {items.length ? items.map((item) => (
        <article key={item.title}>
          <span>{item.title}</span>
          <small>{formatFocusDuration(item.seconds)} · {item.count} 次</small>
        </article>
      )) : <p>暂无记录。</p>}
    </div>
  );
}

type StatsPeriod = "day" | "week" | "month";

function statsPeriodLabel(period: StatsPeriod): string {
  return { day: "日", week: "周", month: "月" }[period];
}

function periodStart(period: StatsPeriod, now: Date): Date {
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
}

function recordsForPeriod<T extends { ended_at: string; deleted_at: string | null }>(records: T[], period: StatsPeriod, now: Date): T[] {
  const start = periodStart(period, now).getTime();
  const end = now.getTime();
  return records.filter((record) => {
    const endedAt = new Date(record.ended_at).getTime();
    return !record.deleted_at && endedAt >= start && endedAt <= end;
  });
}

function totalRestSeconds(sessions: RestSession[]): number {
  return sessions.reduce((sum, session) => sum + Math.max(0, Number(session.duration_seconds ?? 0)), 0);
}

function plannedSecondsForMode(mode: FocusTimerMode, settings: typeof DEFAULT_SETTINGS): number {
  if (mode === "pomodoro") return settings.pomodoro_minutes * 60;
  if (mode === "rest") return settings.short_break_minutes * 60;
  if (mode === "countdown") return settings.countdown_minutes * 60;
  return 0;
}


interface FocusSessionDialogProps {
  session: FocusSession;
  events: EventItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function FocusSessionDialog({ session, events, onClose, onSaved }: FocusSessionDialogProps) {
  const [taskTitle, setTaskTitle] = useState(session.task_title);
  const [mode, setMode] = useState<FocusMode>(session.mode);
  const [linkedEventId, setLinkedEventId] = useState(session.linked_event_id ?? "");
  const [durationMinutes, setDurationMinutes] = useState(Math.max(1, Math.round(session.duration_seconds / 60)));
  const [completed, setCompleted] = useState(session.completed);
  const [interrupted, setInterrupted] = useState(session.interrupted);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) {
      setMessage("请填写任务名称。");
      return;
    }
    const durationSeconds = Math.max(1, Math.round(Number(durationMinutes) * 60));
    const updated: FocusSession = {
      ...session,
      ...syncFields(session),
      mode,
      task_title: taskTitle.trim(),
      linked_event_id: linkedEventId || null,
      planned_seconds: mode === "stopwatch" || mode === "lock" ? null : session.planned_seconds ?? durationSeconds,
      duration_seconds: durationSeconds,
      completed,
      interrupted
    };
    await db.focusSessions.put(updated);
    await queueChange("focusSessions", updated.id);
    onSaved("专注记录已更新。");
  }

  return (
    <Modal title="编辑专注记录" onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <label>任务名称<input autoFocus required value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label>
        <label>模式
          <select value={mode} onChange={(event) => setMode(event.target.value as FocusMode)}>
            <option value="stopwatch">正计时</option>
            <option value="pomodoro">番茄钟</option>
            <option value="countdown">倒计时</option>
            <option value="lock">锁机</option>
          </select>
        </label>
        <label>专注时长（分钟）<input type="number" min={1} max={1440} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label>
        <label>关联任务
          <select value={linkedEventId} onChange={(event) => setLinkedEventId(event.target.value)}>
            <option value="">无</option>
            {events.slice(0, 120).map((eventItem) => <option key={eventItem.id} value={eventItem.id}>{eventItem.title}</option>)}
          </select>
        </label>
        <label className="checkbox-label"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />已完成</label>
        <label className="checkbox-label"><input type="checkbox" checked={interrupted} onChange={(event) => setInterrupted(event.target.checked)} />中断结束</label>
        {message && <p className="auth-message error">{message}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>取消</button>
          <button className="button primary">保存记录</button>
        </div>
      </form>
    </Modal>
  );
}
