import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, queueChange } from "../db";
import { DEFAULT_TIME_ROWS, WEEKDAY_NAMES } from "../data/defaults";
import { syncFields } from "../lib/identity";
import type { ClassPeriod, Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface PeriodSettingsDialogProps {
  semester: Semester;
  onClose: () => void;
}

export function PeriodSettingsDialog({ semester, onClose }: PeriodSettingsDialogProps) {
  const [weekday, setWeekday] = useState<Weekday>(1);
  const storedPeriods = useLiveQuery(
    () => db.classPeriods.where("[semester_id+weekday]").equals([semester.id, weekday]).filter((item) => !item.deleted_at).sortBy("period_number"),
    [semester.id, weekday]
  );
  const [periods, setPeriods] = useState<ClassPeriod[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (storedPeriods) setPeriods(storedPeriods);
  }, [storedPeriods]);

  function patchPeriod(id: string, patch: Partial<ClassPeriod>) {
    setPeriods((current) => current.map((period) => (period.id === id ? { ...period, ...patch } : period)));
  }

  async function save() {
    if (periods.some((period) => !period.name.trim() || period.end_time <= period.start_time)) return;
    setSaving(true);
    for (const period of periods) {
      const record = { ...period, ...syncFields(period), name: period.name.trim() };
      await db.classPeriods.put(record);
      await queueChange("classPeriods", record.id);
    }
    setSaving(false);
    onClose();
  }

  return (
    <Modal title="每日节次设置" onClose={onClose} wide>
      <div className="weekday-tabs" role="tablist">
        {WEEKDAY_NAMES.map((name, index) => (
          <button key={name} className={weekday === index + 1 ? "active" : ""} onClick={() => setWeekday((index + 1) as Weekday)}>{name.replace("星期", "周")}</button>
        ))}
      </div>
      <p className="form-hint">左侧课表始终显示统一参考时间；这里可以为每个星期分别调整实际上课时间，课程卡片会注明当天时间。</p>
      <div className="period-table">
        <div className="period-table-head"><span>节次</span><span>名称</span><span>开始</span><span>结束</span></div>
        {periods.map((period) => (
          <div className="period-table-row" key={period.id}>
            <strong>{period.period_number}</strong>
            <input value={period.name} onChange={(event) => patchPeriod(period.id, { name: event.target.value })} />
            <input type="time" value={period.start_time} onChange={(event) => patchPeriod(period.id, { start_time: event.target.value })} />
            <input type="time" value={period.end_time} onChange={(event) => patchPeriod(period.id, { end_time: event.target.value })} />
          </div>
        ))}
        <div className="period-table-row lunch-preview">
          <strong>—</strong><span>午休</span><span>{DEFAULT_TIME_ROWS[4].startTime}</span><span>{DEFAULT_TIME_ROWS[4].endTime}</span>
        </div>
      </div>
      <div className="form-actions">
        <button className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存节次"}</button>
      </div>
    </Modal>
  );
}
