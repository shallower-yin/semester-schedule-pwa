import { useMemo, useState } from "react";
import { db, queueChange } from "../db";
import { eventOccursOn, toISODate } from "../lib/date";
import { setEventCompletedForDate, postponeEventToDate } from "../lib/eventActions";
import { hardDeleteEventsCascade } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { showToast } from "../lib/toast";
import type { Category, EventItem, EventOccurrenceState } from "../types";
import { Modal } from "./Modal";

interface BatchEventsDialogProps {
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  onClose: () => void;
}

export function BatchEventsDialog({ events, categories, occurrenceStates, onClose }: BatchEventsDialogProps) {
  const activeEvents = useMemo(() => events.filter((event) => !event.deleted_at).sort((left, right) => left.start_date.localeCompare(right.start_date)), [events]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [message, setMessage] = useState("");
  const today = new Date();

  const selectedEvents = activeEvents.filter((event) => selectedIds.includes(event.id));

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function markTodayCompleted() {
    for (const eventItem of selectedEvents) {
      if (eventOccursOn(eventItem, today)) await setEventCompletedForDate(eventItem, occurrenceStates, today, true);
    }
    setMessage(`已标记 ${selectedEvents.length} 个事项/习惯。`);
    showToast(`已标记 ${selectedEvents.length} 个事项/习惯。`, "success");
  }

  async function moveToDate() {
    const target = window.prompt("移动到哪一天？", toISODate(today));
    if (!target) return;
    for (const eventItem of selectedEvents) await postponeEventToDate(eventItem, target);
    setMessage(`已移动 ${selectedEvents.length} 个事项/习惯到 ${target}。`);
    showToast(`已移动 ${selectedEvents.length} 个事项/习惯到 ${target}。`, "success");
  }

  async function updateCategory() {
    await db.transaction("rw", db.events, db.syncQueue, async () => {
      for (const eventItem of selectedEvents) {
        const updated = { ...eventItem, ...syncFields(eventItem), category_id: categoryId || null };
        await db.events.put(updated);
        await queueChange("events", updated.id);
      }
    });
    setMessage(`已更新 ${selectedEvents.length} 个事项/习惯的分类。`);
    showToast(`已更新 ${selectedEvents.length} 个事项/习惯的分类。`, "success");
  }

  async function deleteSelected() {
    if (!window.confirm(`确定彻底删除选中的 ${selectedEvents.length} 个事项/习惯吗？相关完成状态和提醒记录会一并删除，且无法恢复。`)) return;
    await hardDeleteEventsCascade(selectedEvents.map((eventItem) => eventItem.id));
    setSelectedIds([]);
    setMessage("已彻底删除选中项。");
    showToast("已彻底删除选中项。", "success");
  }

  return (
    <Modal title="批量事项" onClose={onClose} wide>
      <div className="batch-dialog">
        <div className="batch-toolbar">
          <button className="button secondary compact" onClick={() => setSelectedIds(activeEvents.map((event) => event.id))}>全选</button>
          <button className="button secondary compact" onClick={() => setSelectedIds([])}>清空</button>
          <span>已选 {selectedEvents.length} 项</span>
        </div>
        <div className="batch-actions">
          <button className="button secondary compact" disabled={!selectedEvents.length} onClick={() => void markTodayCompleted()}>标记今天完成</button>
          <button className="button secondary compact" disabled={!selectedEvents.length} onClick={() => void moveToDate()}>移动日期</button>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">未分类</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <button className="button secondary compact" disabled={!selectedEvents.length} onClick={() => void updateCategory()}>改分类</button>
          <button className="button danger-button compact" disabled={!selectedEvents.length} onClick={() => void deleteSelected()}>删除</button>
        </div>
        {message && <p className="status-message">{message}</p>}
        <div className="batch-list">
          {activeEvents.map((eventItem) => (
            <label key={eventItem.id} className="batch-row">
              <input type="checkbox" checked={selectedIds.includes(eventItem.id)} onChange={() => toggle(eventItem.id)} />
              <span>
                <strong>{eventItem.title}</strong>
                <small>{eventItem.event_type === "habit" ? "习惯" : "事项"} · {eventItem.start_date}{eventItem.end_date !== eventItem.start_date ? ` 至 ${eventItem.end_date}` : ""} · {eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
