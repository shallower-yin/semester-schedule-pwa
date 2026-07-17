import { CalendarPlus, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { db, queueChange } from "../db";
import { parseQuickEntry, QUICK_ENTRY_EXAMPLES } from "../lib/quickEntry";
import { syncFields } from "../lib/identity";
import { showToast } from "../lib/toast";
import type { EventItem } from "../types";
import { Modal } from "./Modal";

interface QuickEntryDialogProps {
  ownerId: string;
  onCreated: (eventItem: EventItem) => void;
  onClose: () => void;
}

export function QuickEntryDialog({ ownerId, onCreated, onClose }: QuickEntryDialogProps) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const draft = useMemo(() => parseQuickEntry(text), [text]);

  async function save() {
    setMessage("");
    if (!draft) {
      setMessage("没有识别出完整事项。请按“日期 时间 内容”的格式输入。");
      return;
    }
    setSaving(true);
    const record: EventItem = {
      ...syncFields(),
      user_id: ownerId,
      event_type: "event",
      title: draft.title,
      start_date: draft.date,
      end_date: draft.date,
      start_time: draft.startTime,
      end_time: draft.endTime,
      all_day: false,
      category_id: null,
      color: "#e36b32",
      location: "",
      note: `由快速录入创建：${text.trim()}`,
      recurrence_type: "none",
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: false,
      reminder_minutes_before: 10,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    await db.events.put(record);
    await queueChange("events", record.id);
    setSaving(false);
    showToast("事项已创建。", "success");
    onCreated(record);
    onClose();
  }

  return (
    <Modal title="快速录入" onClose={onClose}>
      <div className="quick-entry-dialog">
        <label>
          输入一句话
          <textarea
            rows={3}
            value={text}
            placeholder="例如：明天 9：00 交作业（字段之间用空格）"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="quick-entry-examples" aria-label="快速录入样例">
          {QUICK_ENTRY_EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setText(example)}>
              {example}
            </button>
          ))}
        </div>
        <section className={`quick-entry-preview ${draft ? "valid" : ""}`}>
          <Wand2 size={18} />
          {draft ? (
            <div>
              <strong>{draft.title}</strong>
              <span>{draft.date} · {draft.startTime}-{draft.endTime}</span>
            </div>
          ) : (
            <div>
              <strong>支持格式</strong>
              <span>日期 时间 内容，字段之间用空格分隔，例如：明天 9：00 交作业。</span>
            </div>
          )}
        </section>
        {message && <p className="auth-message error">{message}</p>}
        <div className="form-actions">
          <button className="button secondary" onClick={onClose}>取消</button>
          <button className="button primary" disabled={saving} onClick={() => void save()}>
            <CalendarPlus size={17} />{saving ? "保存中…" : "创建事项"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
