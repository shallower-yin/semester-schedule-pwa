import { useLiveQuery } from "dexie-react-hooks";
import { Activity, Bell, ChevronDown, ChevronUp, Clock3, Dumbbell, Footprints, GlassWater, HeartPulse, History, Plus, RotateCcw, Save, Scale, Undo2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { db, queueChange } from "../db";
import { DEFAULT_HEALTH_PROFILE } from "../lib/health";
import { syncFields } from "../lib/identity";
import { enableNotifications } from "../lib/notifications";
import { showToast } from "../lib/toast";
import type { HealthLog, HealthLogKind, HealthProfile } from "../types";

interface HealthPageProps {
  ownerId: string;
}

const EXERCISES = [
  { id: "push_up", label: "俯卧撑", tone: "coral", icon: Dumbbell },
  { id: "sit_up", label: "仰卧起坐", tone: "blue", icon: RotateCcw },
  { id: "squat", label: "深蹲", tone: "green", icon: Footprints }
] as const;

export function HealthPage({ ownerId }: HealthPageProps) {
  const storedProfile = useLiveQuery(
    () => db.healthProfiles.filter((item) => item.user_id === ownerId && !item.deleted_at).first(),
    [ownerId]
  );
  const logs = useLiveQuery(
    () => db.healthLogs.filter((item) => item.user_id === ownerId && !item.deleted_at).reverse().sortBy("logged_at"),
    [ownerId]
  ) ?? [];
  const profile = storedProfile ?? ({ ...DEFAULT_HEALTH_PROFILE } as typeof DEFAULT_HEALTH_PROFILE);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [waterGoal, setWaterGoal] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState<boolean | null>(null);
  const [reminderInterval, setReminderInterval] = useState("");
  const [reminderStart, setReminderStart] = useState("");
  const [reminderEnd, setReminderEnd] = useState("");
  const [movementAmount, setMovementAmount] = useState("5");
  const [exerciseAmount, setExerciseAmount] = useState("10");
  const [showRecent, setShowRecent] = useState(true);

  const today = localDate(new Date());
  const todayLogs = logs.filter((item) => localDate(new Date(item.logged_at)) === today);
  const water = sum(todayLogs, "water");
  const movementMinutes = sum(todayLogs, "movement");
  const exerciseReps = sum(todayLogs, "exercise");
  const latestActivityLog = todayLogs.find((item) => item.kind === "movement" || item.kind === "exercise") ?? null;
  const latestWeight = logs.find((item) => item.kind === "weight")?.amount ?? null;
  const effectiveHeight = numericOr(height, profile.height_cm);
  const effectiveWeight = numericOr(weight, latestWeight);
  const bmi = effectiveHeight && effectiveWeight ? effectiveWeight / ((effectiveHeight / 100) ** 2) : null;
  const effectiveGoal = Math.max(250, numericOr(waterGoal, profile.daily_water_goal_ml) ?? 2000);
  const waterPercent = Math.min(100, Math.round((water / effectiveGoal) * 100));
  const remainingWater = Math.max(0, effectiveGoal - water);
  const weightHistory = useMemo(() => logs.filter((item) => item.kind === "weight").slice(0, 7), [logs]);
  const movementEntry = clamp(Math.round(numericOr(movementAmount, 5) ?? 5), 1, 600);
  const exerciseEntry = clamp(Math.round(numericOr(exerciseAmount, 10) ?? 10), 1, 10000);

  async function addLog(kind: HealthLogKind, amount: number, unit: HealthLog["unit"], activity: string | null = null) {
    const record: HealthLog = { ...syncFields(), kind, logged_at: new Date().toISOString(), amount, unit, activity, note: "" };
    await db.healthLogs.add(record);
    await queueChange("healthLogs", record.id);
    showToast(`${logLabel(record)}，已记录。`, "success");
  }

  async function removeLog(record: HealthLog | null) {
    if (!record) return;
    const deleted = { ...record, ...syncFields(record), deleted_at: new Date().toISOString() };
    await db.healthLogs.put(deleted);
    await queueChange("healthLogs", deleted.id, "delete");
    showToast(`已撤销：${logLabel(record)}。`, "success");
  }

  async function removeLatest(kind: HealthLogKind) {
    const record = todayLogs.find((item) => item.kind === kind) ?? null;
    await removeLog(record);
  }

  async function saveProfile() {
    const next: HealthProfile = {
      ...syncFields(storedProfile),
      height_cm: clampOptional(numericOr(height, profile.height_cm), 80, 260),
      daily_water_goal_ml: clamp(Math.round(effectiveGoal), 250, 10000),
      movement_reminder_enabled: reminderEnabled ?? profile.movement_reminder_enabled,
      movement_interval_minutes: clamp(Math.round(numericOr(reminderInterval, profile.movement_interval_minutes) ?? 60), 15, 240),
      reminder_start_time: reminderStart || profile.reminder_start_time,
      reminder_end_time: reminderEnd || profile.reminder_end_time
    };
    if (next.movement_reminder_enabled) {
      const result = await enableNotifications();
      if (result === "denied" || result === "unsupported") {
        showToast("系统通知未启用，活动提醒暂时无法显示。", "error");
      }
    }
    await db.healthProfiles.put(next);
    await queueChange("healthProfiles", next.id);
    if (weight.trim()) {
      const nextWeight = clampOptional(Number(weight), 20, 500);
      if (nextWeight) await addLog("weight", nextWeight, "kg");
      setWeight("");
    }
    showToast("健康设置已保存。", "success");
  }

  return (
    <section className="health-page page-stack">
      <header className="page-heading health-heading">
        <div><h1>健康</h1><p>记录饮水、活动和基础身体数据。</p></div>
        <HeartPulse size={28} />
      </header>

      <section className="health-summary-grid" aria-label="今日健康概览">
        <article className="health-water-summary">
          <div className="health-water-ring" style={{ "--health-water-progress": `${waterPercent}%` } as CSSProperties} aria-label={`今日饮水 ${water} 毫升，完成 ${waterPercent}%`}>
            <span><strong>{water} ml</strong><small>{waterPercent}%</small></span>
          </div>
          <div className="health-water-summary-copy">
            <span><GlassWater size={18} />今日饮水</span>
            <strong>{remainingWater > 0 ? `还差 ${remainingWater} ml` : "今日目标已达成"}</strong>
            <small>目标 {effectiveGoal} ml</small>
          </div>
        </article>
        <div className="health-secondary-summary">
          <article className="movement"><Activity /><span>起身活动</span><strong>{movementMinutes} 分钟</strong><small>今日累计</small></article>
          <article className="exercise"><Dumbbell /><span>今日训练</span><strong>{exerciseReps} 次</strong><small>今日累计</small></article>
          <article className={`bmi ${bmiTone(bmi)}`}><Scale /><span>BMI</span><strong>{bmi ? bmi.toFixed(1) : "--"}</strong><small>{bmiLabel(bmi)}</small></article>
        </div>
      </section>

      <section className="health-action-band">
        <div className="health-band-title"><div><GlassWater /><h2>饮水</h2></div><button className="icon-button" aria-label="撤销最近一次饮水" title="撤销最近一次饮水" disabled={!todayLogs.some((item) => item.kind === "water")} onClick={() => void removeLatest("water")}><Undo2 size={16} /></button></div>
        <div className="health-progress-copy"><span>今日 {water} / {effectiveGoal} ml</span><strong>{waterPercent}%</strong></div>
        <div className="health-progress" aria-label={`饮水目标完成 ${waterPercent}%`}><span style={{ width: `${waterPercent}%` }} /></div>
        <div className="health-quick-actions">
          <button className="button secondary" aria-label="+250 ml" onClick={() => void addLog("water", 250, "ml")}><Plus size={17} />250 ml</button>
          <button className="button secondary" aria-label="+500 ml" onClick={() => void addLog("water", 500, "ml")}><Plus size={17} />500 ml</button>
        </div>
      </section>

      <section className="health-action-band">
        <div className="health-band-title">
          <div><Activity /><h2>活动与训练</h2></div>
          <button
            className="icon-button"
            aria-label="撤销最近一次活动或训练"
            title="撤销最近一次活动或训练"
            disabled={!latestActivityLog}
            onClick={() => void removeLog(latestActivityLog)}
          >
            <Undo2 size={16} />
          </button>
        </div>
        <div className="health-entry-controls" aria-label="自定义活动与训练数量">
          <label>活动分钟<input aria-label="本次活动分钟" type="number" inputMode="numeric" min={1} max={600} value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} /></label>
          <button className="button secondary compact health-movement-button" onClick={() => void addLog("movement", movementEntry, "minute", "站立活动")}><Activity size={16} />记录 {movementEntry} 分钟</button>
          <label>训练次数<input aria-label="本次训练次数" type="number" inputMode="numeric" min={1} max={10000} value={exerciseAmount} onChange={(event) => setExerciseAmount(event.target.value)} /></label>
        </div>
        <div className="health-exercise-grid">
          {EXERCISES.map((exercise) => {
            const ExerciseIcon = exercise.icon;
            return (
              <button key={exercise.id} className={`health-exercise-button ${exercise.tone}`} onClick={() => void addLog("exercise", exerciseEntry, "rep", exercise.label)}>
                <ExerciseIcon size={20} /><strong>{exercise.label}</strong><span>+{exerciseEntry} 次</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="health-settings-grid">
        <article className="health-settings-panel">
          <div className="health-band-title"><div><Scale /><h2>身体数据</h2></div></div>
          <div className="health-body-layout">
            <div className="compact-form-grid">
              <label>身高（cm）<input aria-label="身高（cm）" inputMode="decimal" value={height} placeholder={profile.height_cm ? String(profile.height_cm) : "例如 175"} onChange={(event) => setHeight(event.target.value)} /></label>
              <label>本次体重（kg）<input aria-label="本次体重（kg）" inputMode="decimal" value={weight} placeholder={latestWeight ? String(latestWeight) : "例如 65"} onChange={(event) => setWeight(event.target.value)} /></label>
              <label>饮水目标（ml）<input aria-label="饮水目标（ml）" inputMode="numeric" value={waterGoal} placeholder={String(profile.daily_water_goal_ml)} onChange={(event) => setWaterGoal(event.target.value)} /></label>
            </div>
            <div className={`health-bmi-result ${bmiTone(bmi)}`} aria-live="polite">
              <span>BMI</span><strong>{bmi ? bmi.toFixed(1) : "--"}</strong><small>{bmiLabel(bmi)}</small>
            </div>
          </div>
          {weightHistory.length > 0 && <p className="health-history-line">最近体重：{weightHistory.map((item) => `${item.amount}kg`).join(" · ")}</p>}
        </article>

        <article className="health-settings-panel">
          <div className="health-band-title"><div><Bell /><h2>活动提醒</h2></div><label className="switch-label"><input type="checkbox" checked={reminderEnabled ?? profile.movement_reminder_enabled} onChange={(event) => setReminderEnabled(event.target.checked)} />启用</label></div>
          <div className="compact-form-grid health-reminder-form">
            <label>提醒间隔<select value={reminderInterval || String(profile.movement_interval_minutes)} onChange={(event) => setReminderInterval(event.target.value)}><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="120">2 小时</option></select></label>
            <label>开始<input type="time" value={reminderStart || profile.reminder_start_time} onChange={(event) => setReminderStart(event.target.value)} /></label>
            <label>结束<input type="time" value={reminderEnd || profile.reminder_end_time} onChange={(event) => setReminderEnd(event.target.value)} /></label>
          </div>
        </article>
      </section>

      <div className="health-page-actions">
        <button className="button secondary" onClick={() => setShowRecent((value) => !value)}>{showRecent ? <ChevronUp size={16} /> : <ChevronDown size={16} />}最近记录</button>
        <button className="button primary" onClick={() => void saveProfile()}><Save size={16} />保存设置</button>
      </div>
      {showRecent && <section className="health-recent-list">
        <header><div><History size={18} /><h2>最近记录</h2></div><span>今日共 {todayLogs.length} 条</span></header>
        <div className="health-timeline">
          {logs.slice(0, 20).map((item) => <article key={item.id} className={item.kind}>
            <span className="health-timeline-icon">{logIcon(item)}</span>
            <div><strong>{logLabel(item)}</strong><small><Clock3 size={12} />{formatLogDate(item.logged_at)}</small></div>
          </article>)}
          {!logs.length && <p className="health-empty-state">今天从一杯水或一次活动开始记录吧。</p>}
        </div>
      </section>}
    </section>
  );
}

function sum(logs: HealthLog[], kind: HealthLogKind): number {
  return logs.filter((item) => item.kind === kind).reduce((total, item) => total + item.amount, 0);
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function numericOr(value: string, fallback: number | null): number | null {
  if (!value.trim()) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampOptional(value: number | null, min: number, max: number): number | null {
  return value == null || !Number.isFinite(value) ? null : clamp(value, min, max);
}

function bmiLabel(value: number | null): string {
  if (!value) return "填写身高和体重后计算";
  if (value < 18.5) return "偏轻";
  if (value < 24) return "正常范围";
  if (value < 28) return "偏高";
  return "较高";
}

function bmiTone(value: number | null): "empty" | "low" | "normal" | "high" {
  if (!value) return "empty";
  if (value < 18.5) return "low";
  if (value < 24) return "normal";
  return "high";
}

function logLabel(item: HealthLog): string {
  if (item.kind === "water") return `饮水 ${item.amount} ml`;
  if (item.kind === "movement") return `${item.activity || "活动"} ${item.amount} 分钟`;
  if (item.kind === "exercise") return `${item.activity || "训练"} ${item.amount} 次`;
  return `体重 ${item.amount} kg`;
}

function logIcon(item: HealthLog) {
  if (item.kind === "water") return <GlassWater size={16} />;
  if (item.kind === "movement") return <Activity size={16} />;
  if (item.kind === "exercise") return <Dumbbell size={16} />;
  return <Scale size={16} />;
}

function formatLogDate(value: string): string {
  const date = new Date(value);
  const today = localDate(new Date());
  const prefix = localDate(date) === today ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
