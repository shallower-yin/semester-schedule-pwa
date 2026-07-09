import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, Coffee, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { db, queueChange } from "../db";
import { WEEKDAY_NAMES } from "../data/defaults";
import { hardDeleteLocalRecords } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import type { ClassPeriod, Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface PeriodSettingsDialogProps {
  semester: Semester;
  onClose: () => void;
}

function addMinutes(time: string, minutes: number): string {
  const [hours, currentMinutes] = time.split(":").map(Number);
  const total = (hours * 60 + currentMinutes + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function PeriodSettingsDialog({ semester, onClose }: PeriodSettingsDialogProps) {
  const [weekday, setWeekday] = useState<Weekday>(1);
  const storedPeriods = useLiveQuery(
    () => db.classPeriods.where("semester_id").equals(semester.id).toArray(),
    [semester.id]
  );
  const [drafts, setDrafts] = useState<Partial<Record<Weekday, ClassPeriod[]>>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!storedPeriods || initialized) return;
    const grouped: Partial<Record<Weekday, ClassPeriod[]>> = {};
    for (const day of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
      grouped[day] = storedPeriods
        .filter((item) => item.weekday === day && !item.deleted_at)
        .sort((left, right) => (left.sort_order ?? left.period_number) - (right.sort_order ?? right.period_number));
    }
    setDrafts(grouped);
    setInitialized(true);
  }, [storedPeriods, initialized]);

  const blocks = useMemo(() => drafts[weekday] ?? [], [drafts, weekday]);

  function setBlocks(next: ClassPeriod[]) {
    setDrafts((current) => ({ ...current, [weekday]: next }));
    setError("");
  }

  function patchBlock(id: string, patch: Partial<ClassPeriod>) {
    setBlocks(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  }

  function addBlock(kind: "period" | "break") {
    const last = blocks.at(-1);
    const startTime = last?.end_time ?? "08:00";
    const positiveNumbers = blocks.filter((block) => block.period_number > 0).map((block) => block.period_number);
    const negativeNumbers = blocks.filter((block) => block.period_number <= 0).map((block) => block.period_number);
    const periodNumber =
      kind === "period"
        ? Math.max(0, ...positiveNumbers) + 1
        : Math.min(0, ...negativeNumbers) - 1;
    const block: ClassPeriod = {
      ...syncFields(),
      semester_id: semester.id,
      weekday,
      period_number: periodNumber,
      kind,
      sort_order: blocks.length + 1,
      name: kind === "period" ? `第 ${periodNumber} 节` : "休息",
      start_time: startTime,
      end_time: addMinutes(startTime, kind === "period" ? 45 : 30)
    };
    setBlocks([...blocks, block]);
  }

  async function removeBlock(block: ClassPeriod) {
    if (block.kind === "period") {
      const semesterCourses = await db.courses.where("semester_id").equals(semester.id).toArray();
      const courseIds = new Set(semesterCourses.filter((course) => !course.deleted_at).map((course) => course.id));
      const isReferenced = await db.courseSchedules
        .filter(
          (schedule) =>
            courseIds.has(schedule.course_id) &&
            schedule.weekday === block.weekday &&
            !schedule.deleted_at &&
            schedule.start_period <= block.period_number &&
            schedule.end_period >= block.period_number
        )
        .count();
      if (isReferenced) {
        window.alert("这个节次仍被课程使用。请先修改对应课程的上课节次，再删除。");
        return;
      }
    }
    if (storedPeriods?.some((item) => item.id === block.id)) {
      setRemovedIds((current) => [...current, block.id]);
    }
    setBlocks(blocks.filter((item) => item.id !== block.id));
  }

  async function save() {
    const allBlocks = Object.values(drafts).flatMap((items) => items ?? []);
    if (allBlocks.some((block) => !block.name.trim() || block.end_time <= block.start_time)) {
      setError("名称不能为空，结束时间必须晚于开始时间。");
      return;
    }
    for (const day of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
      const dayBlocks = drafts[day] ?? [];
      for (let index = 1; index < dayBlocks.length; index += 1) {
        if (dayBlocks[index].start_time < dayBlocks[index - 1].end_time) {
          setWeekday(day);
          setError(`${WEEKDAY_NAMES[day - 1]}存在时间重叠，请调整后保存。`);
          return;
        }
      }
    }

    setSaving(true);
    await db.transaction("rw", db.classPeriods, db.syncQueue, async () => {
      for (const day of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
        for (const [index, block] of (drafts[day] ?? []).entries()) {
          const record = {
            ...block,
            ...syncFields(block),
            weekday: day,
            sort_order: index + 1,
            name: block.name.trim()
          };
          await db.classPeriods.put(record);
          await queueChange("classPeriods", record.id);
        }
      }
      await hardDeleteLocalRecords("classPeriods", removedIds);
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal title="每日时间块设置" onClose={onClose} wide>
      <div className="weekday-tabs" role="tablist">
        {WEEKDAY_NAMES.map((name, index) => (
          <button key={name} className={weekday === index + 1 ? "active" : ""} onClick={() => setWeekday((index + 1) as Weekday)}>
            {name.replace("星期", "周")}
          </button>
        ))}
      </div>
      <div className="period-toolbar">
        <p>每天可使用不同数量和时间的课程节次、午休或其他休息时段。</p>
        <div>
          <button className="button secondary compact" onClick={() => addBlock("break")}><Coffee size={16} />添加休息</button>
          <button className="button primary compact" onClick={() => addBlock("period")}><Plus size={16} />添加节次</button>
        </div>
      </div>
      <div className="period-table flexible-period-table">
        <div className="period-table-head"><span>排序</span><span>类型</span><span>名称</span><span>开始</span><span>结束</span><span /></div>
        {blocks.map((block, index) => (
          <div className={`period-table-row ${block.kind === "break" ? "break-row" : ""}`} key={block.id}>
            <span className="period-order-buttons">
              <button className="icon-button" disabled={index === 0} onClick={() => moveBlock(index, -1)} aria-label="上移"><ArrowUp size={16} /></button>
              <button className="icon-button" disabled={index === blocks.length - 1} onClick={() => moveBlock(index, 1)} aria-label="下移"><ArrowDown size={16} /></button>
            </span>
            <span className="time-block-kind">{block.kind === "period" ? "课程节次" : "休息时段"}</span>
            <input value={block.name} onChange={(event) => patchBlock(block.id, { name: event.target.value })} />
            <input type="time" value={block.start_time} onChange={(event) => patchBlock(block.id, { start_time: event.target.value })} />
            <input type="time" value={block.end_time} onChange={(event) => patchBlock(block.id, { end_time: event.target.value })} />
            <button className="icon-button danger" onClick={() => void removeBlock(block)} aria-label="删除时间块"><Trash2 size={17} /></button>
          </div>
        ))}
        {!blocks.length && <div className="period-empty">这一天没有时间块，可按需要添加。</div>}
      </div>
      {error && <p className="auth-message error">{error}</p>}
      <div className="form-actions">
        <button className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存时间块"}</button>
      </div>
    </Modal>
  );
}
