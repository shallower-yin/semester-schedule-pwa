import { useEffect, useState } from "react";
import { db, queueChange } from "../db";
import { deduplicateCategories } from "../lib/categories";
import { getSyncHealth, type SyncHealth } from "../lib/sync";
import { syncFields } from "../lib/identity";
import type { EventItem } from "../types";
import { Modal } from "./Modal";

interface DataHealthDialogProps {
  ownerId: string;
  onClose: () => void;
}

interface DataHealthReport {
  sync: SyncHealth | null;
  duplicateCategoryGroups: number;
  invalidEvents: EventItem[];
  missingRecurrenceInterval: EventItem[];
  checkedAt: string;
}

export function DataHealthDialog({ ownerId, onClose }: DataHealthDialogProps) {
  const [report, setReport] = useState<DataHealthReport | null>(null);
  const [message, setMessage] = useState("");

  async function inspect() {
    const [sync, categories, events] = await Promise.all([
      getSyncHealth(),
      db.categories.filter((category) => category.user_id === ownerId && !category.deleted_at).toArray(),
      db.events.filter((event) => event.user_id === ownerId && !event.deleted_at).toArray()
    ]);
    const categoryNames = new Map<string, number>();
    for (const category of categories) {
      const key = category.name.trim().toLocaleLowerCase("zh-CN");
      categoryNames.set(key, (categoryNames.get(key) ?? 0) + 1);
    }
    setReport({
      sync,
      duplicateCategoryGroups: Array.from(categoryNames.values()).filter((count) => count > 1).length,
      invalidEvents: events.filter((event) => !event.title.trim() || event.end_date < event.start_date || (!event.all_day && event.end_time && event.start_time && event.end_time < event.start_time)),
      missingRecurrenceInterval: events.filter((event) => typeof event.recurrence_interval !== "number"),
      checkedAt: new Date().toISOString()
    });
  }

  async function repair() {
    const removedCategories = await deduplicateCategories(ownerId);
    const events = await db.events.filter((event) => event.user_id === ownerId && !event.deleted_at && typeof event.recurrence_interval !== "number").toArray();
    for (const event of events) {
      const updated = { ...event, ...syncFields(event), recurrence_interval: 1 };
      await db.events.put(updated);
      await queueChange("events", updated.id);
    }
    setMessage(`修复完成：合并 ${removedCategories} 个重复分类，补齐 ${events.length} 个事项字段。`);
    await inspect();
  }

  useEffect(() => {
    void inspect();
  }, [ownerId]);

  return (
    <Modal title="数据健康检查" onClose={onClose} wide>
      <div className="health-dialog">
        {report ? (
          <>
            <div className="health-grid">
              <article><strong>{report.sync?.pending ?? 0}</strong><span>待同步</span></article>
              <article><strong>{report.sync?.failed ?? 0}</strong><span>同步异常</span></article>
              <article><strong>{report.duplicateCategoryGroups}</strong><span>重复分类组</span></article>
              <article><strong>{report.invalidEvents.length}</strong><span>异常事项</span></article>
            </div>
            <div className="health-list">
              <p>检查时间：{report.checkedAt.slice(0, 19).replace("T", " ")}</p>
              <p>网络：{report.sync?.online ? "在线" : "离线"} · 云端配置：{report.sync?.cloud_configured ? "已配置" : "未配置"}</p>
              {report.sync?.tables.map((table) => (
                <p key={table.table_name}>{table.label}：{table.pending} 条待同步{table.last_error ? ` · ${table.last_error}` : ""}</p>
              ))}
              {report.invalidEvents.map((event) => <p key={event.id}>异常事项：{event.title || event.id}</p>)}
            </div>
          </>
        ) : <p>正在检查…</p>}
        {message && <p className="status-message">{message}</p>}
        <div className="form-actions">
          <button className="button secondary" onClick={() => void inspect()}>重新检查</button>
          <button className="button primary" onClick={() => void repair()}>自动修复可修复项</button>
        </div>
      </div>
    </Modal>
  );
}
