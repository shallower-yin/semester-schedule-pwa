import { useState } from "react";
import { db, queueChange } from "../db";
import { defaultPeriodsForWeekday } from "../data/defaults";
import { syncFields } from "../lib/identity";
import type { Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface SemesterDialogProps {
  semester?: Semester;
  onClose: () => void;
}

function currentMonday(): string {
  const date = new Date();
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SemesterDialog({ semester, onClose }: SemesterDialogProps) {
  const [name, setName] = useState(semester?.name ?? "");
  const [startDate, setStartDate] = useState(semester?.start_date ?? currentMonday());
  const [totalWeeks, setTotalWeeks] = useState(semester?.total_weeks ?? 20);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || totalWeeks < 1 || totalWeeks > 60) return;
    setSaving(true);
    const fields = syncFields(semester);
    const record: Semester = {
      ...fields,
      name: name.trim(),
      start_date: startDate,
      total_weeks: totalWeeks,
      is_current: true
    };
    await db.transaction("rw", db.semesters, db.classPeriods, db.syncQueue, async () => {
      await db.semesters.toCollection().modify({ is_current: false });
      await db.semesters.put(record);
      await queueChange("semesters", record.id);
      if (!semester) {
        const periods = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).flatMap((weekday) =>
          defaultPeriodsForWeekday(weekday).map((period) => ({
            ...syncFields(),
            semester_id: record.id,
            ...period
          }))
        );
        await db.classPeriods.bulkAdd(periods);
        for (const period of periods) await queueChange("classPeriods", period.id);
      }
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal title={semester ? "编辑学期" : "创建学期"} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <label>
          学期名称
          <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：2026 秋季学期" />
        </label>
        <label>
          第一教学周的星期一
          <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          总周数
          <input
            required
            type="number"
            min={1}
            max={60}
            value={totalWeeks}
            onChange={(event) => setTotalWeeks(Number(event.target.value))}
          />
        </label>
        <p className="form-hint">新学期会自动建立周一至周日的默认节次，可在“节次设置”中分别修改每天的作息。</p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>取消</button>
          <button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </Modal>
  );
}
