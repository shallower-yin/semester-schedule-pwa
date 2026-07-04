import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db, queueChange } from "../db";
import { syncFields } from "../lib/identity";
import type { EventItem } from "../types";
import { Modal } from "./Modal";

interface EventDialogProps {
  eventItem?: EventItem;
  initialDate: string;
  initialStartTime?: string;
  initialEndTime?: string;
  initialAllDay?: boolean;
  onClose: () => void;
}

export function EventDialog({ eventItem, initialDate, initialStartTime = "09:00", initialEndTime = "10:00", initialAllDay = false, onClose }: EventDialogProps) {
  const categories = useLiveQuery(() => db.categories.filter((item) => !item.deleted_at).toArray(), []) ?? [];
  const [title, setTitle] = useState(eventItem?.title ?? "");
  const [date, setDate] = useState(eventItem?.start_date ?? initialDate);
  const [startTime, setStartTime] = useState(eventItem?.start_time ?? initialStartTime);
  const [endTime, setEndTime] = useState(eventItem?.end_time ?? initialEndTime);
  const [allDay, setAllDay] = useState(eventItem?.all_day ?? initialAllDay);
  const [categoryId, setCategoryId] = useState(eventItem?.category_id ?? "");
  const [color, setColor] = useState(eventItem?.color ?? "#e36b32");
  const [note, setNote] = useState(eventItem?.note ?? "");
  const [recurrence, setRecurrence] = useState<"none" | "weekly">(eventItem?.recurrence_type ?? "none");
  const [recurrenceUntil, setRecurrenceUntil] = useState(eventItem?.recurrence_until ?? initialDate);
  const [saving, setSaving] = useState(false);

  async function save(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || (!allDay && endTime <= startTime)) return;
    setSaving(true);
    const record: EventItem = {
      ...syncFields(eventItem),
      title: title.trim(),
      start_date: date,
      end_date: date,
      start_time: allDay ? null : startTime,
      end_time: allDay ? null : endTime,
      all_day: allDay,
      category_id: categoryId || null,
      color,
      note: note.trim(),
      recurrence_type: recurrence,
      recurrence_until: recurrence === "weekly" ? recurrenceUntil : null
    };
    await db.events.put(record);
    await queueChange("events", record.id);
    setSaving(false);
    onClose();
  }

  async function remove() {
    if (!eventItem || !window.confirm(`删除事项“${eventItem.title}”？`)) return;
    await db.events.put({ ...eventItem, ...syncFields(eventItem), deleted_at: new Date().toISOString() });
    await queueChange("events", eventItem.id, "delete");
    onClose();
  }

  return (
    <Modal title={eventItem ? "编辑事项" : "新增事项"} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <label>标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>日期<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />全天事项</label>
        {!allDay && (
          <div className="form-grid">
            <label>开始时间<input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label>结束时间<input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          </div>
        )}
        <div className="form-grid">
          <label>分类
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">未分类</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>颜色<input className="color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        </div>
        <label>重复
          <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as "none" | "weekly")}>
            <option value="none">不重复</option>
            <option value="weekly">每周重复</option>
          </select>
        </label>
        {recurrence === "weekly" && <label>重复截止日期<input type="date" min={date} value={recurrenceUntil} onChange={(event) => setRecurrenceUntil(event.target.value)} /></label>}
        <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="form-actions split">
          <div>{eventItem && <button type="button" className="button danger-button" onClick={remove}>删除事项</button>}</div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存事项"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
