import { useLiveQuery } from "dexie-react-hooks";
import { Activity, Bell, ChevronDown, ChevronUp, Clock3, Dumbbell, Footprints, GlassWater, HeartPulse, History, ListPlus, Plus, RotateCcw, Save, Scale, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { db, queueChange } from "../db";
import { DEFAULT_EXERCISE_ITEMS, DEFAULT_HEALTH_PROFILE } from "../lib/health";
import { syncFields } from "../lib/identity";
import { enableNotifications } from "../lib/notifications";
import { showToast } from "../lib/toast";
import type { HealthLog, HealthLogKind, HealthProfile } from "../types";
import { Modal } from "./Modal";

interface HealthPageProps {
  ownerId: string;
}

const EXERCISE_PRESETS = {
  俯卧撑: { tone: "coral", icon: Dumbbell },
  仰卧起坐: { tone: "blue", icon: RotateCcw },
  深蹲: { tone: "green", icon: Footprints }
} as const;
const EXERCISE_TONES = ["coral", "blue", "green"] as const;

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
  const [exerciseItems, setExerciseItems] = useState<string[] | null>(null);
  const [newExerciseItem, setNewExerciseItem] = useState("");
  const [showExerciseManager, setShowExerciseManager] = useState(false);
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
  const effectiveExerciseItems = exerciseItems ?? normalizeExerciseItems(profile.exercise_items);

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
      exercise_items: effectiveExerciseItems,
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

  function addExerciseItem() {
    const name = newExerciseItem.trim().slice(0, 20);
    if (!name) return;
    if (effectiveExerciseItems.includes(name)) {
      showToast("该训练项目已经存在。", "error");
      return;
    }
    if (effectiveExerciseItems.length >= 12) {
      showToast("最多保留 12 个训练项目。", "error");
      return;
    }
    setExerciseItems([...effectiveExerciseItems, name]);
    setNewExerciseItem("");
  }

  function removeExerciseItem(name: string) {
    if (effectiveExerciseItems.length <= 1) {
      showToast("至少保留一个训练项目。", "error");
      return;
    }
    setExerciseItems(effectiveExerciseItems.filter((item) => item !== name));
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

      <section className="health-action-band health-water-band">
        <div className="health-band-title"><div><GlassWater /><h2>饮水</h2></div><button className="icon-button" aria-label="撤销最近一次饮水" title="撤销最近一次饮水" disabled={!todayLogs.some((item) => item.kind === "water")} onClick={() => void removeLatest("water")}><Undo2 size={16} /></button></div>
        <div className="health-progress-copy"><span>今日 {water} / {effectiveGoal} ml</span><strong>{waterPercent}%</strong></div>
        <div className="health-progress" aria-label={`饮水目标完成 ${waterPercent}%`}><span style={{ width: `${waterPercent}%` }} /></div>
        <div className="health-quick-actions">
          <button className="button secondary" aria-label="+250 ml" onClick={() => void addLog("water", 250, "ml")}><Plus size={17} />250 ml</button>
          <button className="button secondary" aria-label="+500 ml" onClick={() => void addLog("water", 500, "ml")}><Plus size={17} />500 ml</button>
        </div>
      </section>

      <section className="health-action-band health-training-band">
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
          <label className="health-inline-field"><span>活动分钟</span><input aria-label="本次活动分钟" type="number" inputMode="numeric" min={1} max={600} value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} /></label>
          <button className="button secondary compact health-movement-button" onClick={() => void addLog("movement", movementEntry, "minute", "站立活动")}><Activity size={16} />记录 {movementEntry} 分钟</button>
          <label className="health-inline-field"><span>训练次数</span><input aria-label="本次训练次数" type="number" inputMode="numeric" min={1} max={10000} value={exerciseAmount} onChange={(event) => setExerciseAmount(event.target.value)} /></label>
          <button className="button secondary compact health-manage-exercises" onClick={() => setShowExerciseManager(true)}><ListPlus size={16} />增减训练项目</button>
        </div>
        <div className="health-exercise-grid">
          {effectiveExerciseItems.map((exercise, index) => {
            const appearance = exerciseAppearance(exercise, index);
            const ExerciseIcon = appearance.icon;
            return (
              <button key={exercise} className={`health-exercise-button ${appearance.tone}`} onClick={() => void addLog("exercise", exerciseEntry, "rep", exercise)}>
                <ExerciseIcon size={20} /><strong>{exercise}</strong><span>+{exerciseEntry} 次</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="health-settings-grid">
        <article className="health-settings-panel health-body-panel">
          <div className="health-band-title"><div><Scale /><h2>身体数据</h2></div></div>
          <div className="health-body-layout">
            <label className="health-inline-field"><span>身高（cm）</span><input aria-label="身高（cm）" inputMode="decimal" value={height} placeholder={profile.height_cm ? String(profile.height_cm) : "例如 175"} onChange={(event) => setHeight(event.target.value)} /></label>
            <label className="health-inline-field"><span>体重（kg）</span><input aria-label="本次体重（kg）" inputMode="decimal" value={weight} placeholder={latestWeight ? String(latestWeight) : "例如 65"} onChange={(event) => setWeight(event.target.value)} /></label>
            <label className="health-inline-field"><span>饮水目标（ml）</span><input aria-label="饮水目标（ml）" inputMode="numeric" value={waterGoal} placeholder={String(profile.daily_water_goal_ml)} onChange={(event) => setWaterGoal(event.target.value)} /></label>
            <div className={`health-bmi-result ${bmiTone(bmi)}`} aria-live="polite">
              <span>BMI</span><strong>{bmi ? bmi.toFixed(1) : "--"}</strong><small>{bmiLabel(bmi)}</small>
            </div>
          </div>
          {weightHistory.length > 0 && <p className="health-history-line">最近体重：{weightHistory.map((item) => `${item.amount}kg`).join(" · ")}</p>}
        </article>

        <article className="health-settings-panel health-reminder-panel">
          <div className="health-band-title"><div><Bell /><h2>活动提醒</h2></div><label className="switch-label"><input type="checkbox" checked={reminderEnabled ?? profile.movement_reminder_enabled} onChange={(event) => setReminderEnabled(event.target.checked)} />启用</label></div>
          <div className="health-reminder-form">
            <label className="health-inline-field"><span>提醒间隔</span><select aria-label="提醒间隔" value={reminderInterval || String(profile.movement_interval_minutes)} onChange={(event) => setReminderInterval(event.target.value)}><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="120">2 小时</option></select></label>
            <label className="health-inline-field"><span>开始</span><input aria-label="开始" type="time" value={reminderStart || profile.reminder_start_time} onChange={(event) => setReminderStart(event.target.value)} /></label>
            <label className="health-inline-field"><span>结束</span><input aria-label="结束" type="time" value={reminderEnd || profile.reminder_end_time} onChange={(event) => setReminderEnd(event.target.value)} /></label>
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
      {showExerciseManager && <Modal title="训练项目" onClose={() => setShowExerciseManager(false)} className="health-exercise-modal">
        <div className="health-exercise-editor-list">
          {effectiveExerciseItems.map((item) => <div key={item}>
            <span>{item}</span>
            <button className="icon-button danger" aria-label={`删除${item}`} title={`删除${item}`} onClick={() => removeExerciseItem(item)}><Trash2 size={16} /></button>
          </div>)}
        </div>
        <div className="health-exercise-add-row">
          <input aria-label="新训练项目名称" value={newExerciseItem} maxLength={20} placeholder="例如：平板支撑" onChange={(event) => setNewExerciseItem(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addExerciseItem(); } }} />
          <button className="button secondary" onClick={addExerciseItem}><Plus size={16} />添加</button>
        </div>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setExerciseItems([...DEFAULT_EXERCISE_ITEMS])}><RotateCcw size={16} />恢复默认</button>
          <button className="button primary" onClick={() => setShowExerciseManager(false)}>完成</button>
        </div>
      </Modal>}
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

function normalizeExerciseItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_EXERCISE_ITEMS];
  const items = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 12);
  return items.length ? items : [...DEFAULT_EXERCISE_ITEMS];
}

function exerciseAppearance(label: string, index: number) {
  const preset = EXERCISE_PRESETS[label as keyof typeof EXERCISE_PRESETS];
  return preset ?? { tone: EXERCISE_TONES[index % EXERCISE_TONES.length], icon: Dumbbell };
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
