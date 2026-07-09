import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, Bell, CheckCircle2, Edit3, ListChecks, Link2, Pause, Play, RotateCcw, Settings, Square, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import {
  elapsedFocusSeconds,
  focusDailyTotals,
  focusModeLabel,
  focusSessionsForDate,
  formatFocusDuration,
  remainingFocusSeconds,
  totalFocusSeconds,
  type ActiveFocusState
} from "../lib/focus";
import { hardDeleteLocalRecord } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { showToast } from "../lib/toast";
import type { EventItem, FocusMode, FocusSession, FocusSettings } from "../types";
import { Modal } from "./Modal";

interface FocusPageProps {
  ownerId: string;
}

const DEFAULT_SETTINGS = {
  pomodoro_minutes: 25,
  short_break_minutes: 5,
  countdown_minutes: 30,
  daily_goal_minutes: 120,
  sound_enabled: true
};

function activeFocusKey(ownerId: string) {
  return `semester-schedule-active-focus:${ownerId}`;
}

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
  const events = useLiveQuery(
    () => db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
    [ownerId]
  ) ?? [];
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [taskTitle, setTaskTitle] = useState("");
  const [linkedEventId, setLinkedEventId] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [active, setActive] = useState<ActiveFocusState | null>(() => loadActiveFocus(ownerId));
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState("");
  const [sessionToEdit, setSessionToEdit] = useState<FocusSession | null>(null);
  const completingRef = useRef(false);

  const effectiveSettings = storedSettings ?? settingsDraft;
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
  const elapsed = active ? elapsedFocusSeconds(active, now) : 0;
  const remaining = active ? remainingFocusSeconds(active, now) : null;
  const displaySeconds = active ? remaining ?? elapsed : plannedSecondsForMode(mode, effectiveSettings);
  const progress = active?.planned_seconds ? Math.min(1, elapsed / active.planned_seconds) : 0;

  useEffect(() => {
    if (storedSettings) {
      setSettingsDraft({
        pomodoro_minutes: storedSettings.pomodoro_minutes,
        short_break_minutes: storedSettings.short_break_minutes,
        countdown_minutes: storedSettings.countdown_minutes,
        daily_goal_minutes: storedSettings.daily_goal_minutes,
        sound_enabled: storedSettings.sound_enabled
      });
    }
  }, [storedSettings?.id, storedSettings?.updated_at]);

  useEffect(() => {
    setActive(loadActiveFocus(ownerId));
  }, [ownerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!active) return;
    saveActiveFocus(ownerId, active);
  }, [active, ownerId]);

  useEffect(() => {
    if (!active || active.pause_started_at || active.planned_seconds == null || completingRef.current) return;
    if ((remaining ?? 1) > 0) return;
    completingRef.current = true;
    void finishFocus(true, false).finally(() => {
      completingRef.current = false;
    });
  }, [active, remaining]);

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

  function startFocus() {
    const title = taskTitle.trim() || selectedEvent?.title || focusModeLabel(mode);
    const plannedSeconds = plannedSecondsForMode(mode, effectiveSettings);
    const next: ActiveFocusState = {
      mode,
      task_title: title,
      linked_event_id: linkedEventId || null,
      planned_seconds: mode === "stopwatch" || mode === "lock" ? null : plannedSeconds,
      started_at: new Date().toISOString(),
      paused_seconds: 0,
      pause_started_at: null
    };
    setActive(next);
    saveActiveFocus(ownerId, next);
    if (mode === "lock") void enterFocusFullscreen();
    setMessage("");
  }

  function pauseOrResume() {
    if (!active) return;
    const current = new Date();
    if (active.pause_started_at) {
      const pausedFor = Math.max(0, Math.floor((current.getTime() - new Date(active.pause_started_at).getTime()) / 1000));
      setActive({ ...active, paused_seconds: active.paused_seconds + pausedFor, pause_started_at: null });
    } else {
      setActive({ ...active, pause_started_at: current.toISOString() });
    }
  }

  async function finishFocus(completed: boolean, interrupted: boolean) {
    if (!active) return;
    const endedAt = new Date();
    const duration = Math.max(1, elapsedFocusSeconds(active, endedAt));
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
      interrupted
    };
    await db.focusSessions.put(record);
    await queueChange("focusSessions", record.id);
    clearActiveFocus(ownerId);
    void exitFocusFullscreen();
    setActive(null);
    setTaskTitle("");
    setLinkedEventId("");
    setMessage(completed ? `已完成 ${formatFocusDuration(duration)} 专注。` : `已保存 ${formatFocusDuration(duration)} 专注记录。`);
    showToast(completed ? `已完成 ${formatFocusDuration(duration)} 专注。` : `已保存 ${formatFocusDuration(duration)} 专注记录。`, "success");
    if (completed) notifyFocusComplete(record.task_title, effectiveSettings.sound_enabled);
  }

  function discardFocus() {
    if (!active || !window.confirm("放弃当前专注？不会保存本次记录。")) return;
    clearActiveFocus(ownerId);
    void exitFocusFullscreen();
    setActive(null);
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

  return (
    <section className="focus-page">
      <div className="page-heading focus-heading">
        <div>
          <h1>专注</h1>
          <p>正计时、倒计时、番茄钟和锁机记录会同步到手机和电脑。</p>
        </div>
        <div className="focus-stats">
          <span><strong>{formatFocusDuration(todaySeconds)}</strong><small>今日</small></span>
          <span><strong>{formatFocusDuration(weekSeconds)}</strong><small>本周</small></span>
          <span><strong>{todaySessions.length}</strong><small>今日次数</small></span>
        </div>
      </div>

      <div className="focus-layout">
        <section className="focus-panel">
          <div className="focus-mode-tabs">
            {(["stopwatch", "pomodoro", "countdown", "lock"] as FocusMode[]).map((item) => (
              <button key={item} className={mode === item ? "active" : ""} disabled={Boolean(active)} onClick={() => setMode(item)}>
                {focusModeLabel(item)}
              </button>
            ))}
          </div>

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

          <div className="focus-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}>
            <div>
              <Target size={34} />
              <strong>{formatFocusDuration(displaySeconds)}</strong>
              <span>{active ? active.task_title : focusModeLabel(mode)}</span>
            </div>
          </div>

          {!active ? (
            <button className="button primary focus-start-button" onClick={startFocus}><Play size={18} />开始专注</button>
          ) : (
            <div className="focus-actions">
              <button className="button secondary" onClick={pauseOrResume}>{active.pause_started_at ? <Play size={17} /> : <Pause size={17} />}{active.pause_started_at ? "继续" : "暂停"}</button>
              <button className="button primary" onClick={() => void finishFocus(active.planned_seconds == null || elapsed >= active.planned_seconds, Boolean(active.planned_seconds && elapsed < active.planned_seconds))}><CheckCircle2 size={17} />结束并保存</button>
              <button className="button danger-button" onClick={discardFocus}><Square size={16} />放弃</button>
            </div>
          )}
          {message && <p className="status-message">{message}</p>}
        </section>

        <aside className="focus-side">
          <section>
            <h2><Settings size={18} />番茄设置</h2>
            <div className="focus-settings-grid">
              <label>番茄分钟<input type="number" min={1} max={240} value={settingsDraft.pomodoro_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, pomodoro_minutes: Number(event.target.value) })} /></label>
              <label>休息分钟<input type="number" min={1} max={120} value={settingsDraft.short_break_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, short_break_minutes: Number(event.target.value) })} /></label>
              <label>倒计时分钟<input type="number" min={1} max={720} value={settingsDraft.countdown_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, countdown_minutes: Number(event.target.value) })} /></label>
              <label>每日目标<input type="number" min={1} max={1440} value={settingsDraft.daily_goal_minutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, daily_goal_minutes: Number(event.target.value) })} /></label>
            </div>
            <label className="checkbox-label focus-sound"><input type="checkbox" checked={settingsDraft.sound_enabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, sound_enabled: event.target.checked })} /><Bell size={16} />结束提醒</label>
            <button className="button secondary compact" onClick={() => void saveSettings()}><RotateCcw size={16} />保存设置</button>
          </section>

          <section>
            <h2><BarChart3 size={18} />近 7 日统计</h2>
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

          <section>
            <h2>最近记录</h2>
            <div className="focus-record-list">
              {sessions
                .slice()
                .sort((left, right) => right.ended_at.localeCompare(left.ended_at))
                .slice(0, 8)
                .map((session) => (
                  <article key={session.id}>
                    <strong>{session.task_title || focusModeLabel(session.mode)}</strong>
                    <span>{focusModeLabel(session.mode)} · {formatFocusDuration(session.duration_seconds)} · {new Date(session.ended_at).toLocaleString()}</span>
                    <div className="focus-record-actions">
                      <button className="button secondary compact" onClick={() => setSessionToEdit(session)}><Edit3 size={14} />编辑</button>
                      <button className="button danger-button compact" onClick={() => void deleteSession(session)}><Trash2 size={14} />彻底删除</button>
                    </div>
                  </article>
                ))}
              {!sessions.length && <p>还没有专注记录。</p>}
            </div>
          </section>
        </aside>
      </div>

      {active?.mode === "lock" && (
        <div className="focus-lock-overlay" role="dialog" aria-modal="true" aria-label="锁机专注">
          <div className="focus-lock-card">
            <span>锁机专注中</span>
            <h2>{active.task_title}</h2>
            <strong>{formatFocusDuration(elapsed)}</strong>
            <p>这是 PWA 内的锁机界面，会阻挡应用内操作并在关闭页面前提示；浏览器无法真正锁住手机系统返回键或主屏幕。</p>
            <div className="focus-actions">
              <button className="button secondary" onClick={pauseOrResume}>{active.pause_started_at ? <Play size={17} /> : <Pause size={17} />}{active.pause_started_at ? "继续" : "暂停"}</button>
              <button className="button primary" onClick={() => void finishFocus(true, false)}><CheckCircle2 size={17} />结束并保存</button>
              <button className="button danger-button" onClick={discardFocus}><Square size={16} />放弃</button>
            </div>
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

function plannedSecondsForMode(mode: FocusMode, settings: typeof DEFAULT_SETTINGS): number {
  if (mode === "pomodoro") return settings.pomodoro_minutes * 60;
  if (mode === "countdown") return settings.countdown_minutes * 60;
  return 0;
}

function loadActiveFocus(ownerId: string): ActiveFocusState | null {
  try {
    const raw = localStorage.getItem(activeFocusKey(ownerId));
    return raw ? JSON.parse(raw) as ActiveFocusState : null;
  } catch {
    return null;
  }
}

function saveActiveFocus(ownerId: string, active: ActiveFocusState) {
  localStorage.setItem(activeFocusKey(ownerId), JSON.stringify(active));
}

function clearActiveFocus(ownerId: string) {
  localStorage.removeItem(activeFocusKey(ownerId));
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

async function enterFocusFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    // 部分手机浏览器不支持全屏 API，保留应用内遮罩即可。
  }
}

async function exitFocusFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // 忽略浏览器全屏退出限制。
  }
}

function notifyFocusComplete(taskTitle: string, soundEnabled: boolean) {
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
    }, 180);
  } catch {
    // 浏览器可能禁止非用户手势音频，忽略即可。
  }
}
