import { useLiveQuery } from "dexie-react-hooks";
import { BellRing, CalendarCheck, Copy } from "lucide-react";
import { useState } from "react";
import { db, queueChange } from "../db";
import { uniqueCategoriesByName } from "../lib/categories";
import { parseLocalDate, toISODate } from "../lib/date";
import { buildEventCompletionRecord, eventCompletionForDate } from "../lib/eventCompletion";
import { validateEventDraft } from "../lib/eventValidation";
import { syncFields } from "../lib/identity";
import { enableNotifications, resetSentRemindersForChangedEvent } from "../lib/notifications";
import type { EventItem, EventOccurrenceState, EventType } from "../types";
import { Modal } from "./Modal";

interface EventDialogProps {
  eventItem?: EventItem;
  initialDate: string;
  initialStartTime?: string;
  initialEndTime?: string;
  initialAllDay?: boolean;
  initialEventType?: EventType;
  ownerId: string;
  occurrenceStates: EventOccurrenceState[];
  onClose: () => void;
}

export function EventDialog({ eventItem, initialDate, initialStartTime = "09:00", initialEndTime = "10:00", initialAllDay = false, initialEventType = "event", ownerId, occurrenceStates, onClose }: EventDialogProps) {
  const categories = uniqueCategoriesByName(
    useLiveQuery(
      () => db.categories.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
      [ownerId]
    ) ?? []
  );
  const [title, setTitle] = useState(eventItem?.title ?? "");
  const [eventType] = useState<EventType>(eventItem?.event_type ?? initialEventType);
  const [date, setDate] = useState(eventItem?.start_date ?? initialDate);
  const [endDate, setEndDate] = useState(eventItem?.end_date ?? initialDate);
  const [startTime, setStartTime] = useState(eventItem?.start_time ?? initialStartTime);
  const [endTime, setEndTime] = useState(eventItem?.end_time ?? initialEndTime);
  const [allDay, setAllDay] = useState(eventItem?.all_day ?? initialAllDay);
  const [categoryId, setCategoryId] = useState(eventItem?.category_id ?? "");
  const [color, setColor] = useState(eventItem?.color ?? "#e36b32");
  const [note, setNote] = useState(eventItem?.note ?? "");
  const [recurrence, setRecurrence] = useState<"none" | "weekly">(eventItem?.recurrence_type ?? "none");
  const [recurrenceUntil, setRecurrenceUntil] = useState(eventItem?.recurrence_until ?? eventItem?.start_date ?? initialDate);
  const [reminderEnabled, setReminderEnabled] = useState(eventItem?.reminder_enabled ?? false);
  const [reminderMinutes, setReminderMinutes] = useState(eventItem?.reminder_minutes_before ?? 10);
  const [reminderMessage, setReminderMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [completionMessage, setCompletionMessage] = useState("");
  const [enablingReminder, setEnablingReminder] = useState(false);
  const [saving, setSaving] = useState(false);
  const todayCompletion = eventItem ? eventCompletionForDate(eventItem, occurrenceStates, new Date()) : null;
  const itemLabel = eventType === "habit" ? "习惯" : "事项";
  const usesDateRange = recurrence === "none" && endDate > date;
  const reminderSummary = reminderEnabled
    ? `${formatReminderLead(reminderMinutes)}提醒，${
        usesDateRange
          ? `首日预计 ${formatReminderPreview(date, allDay, startTime, reminderMinutes)} 触发，之后范围内每天按同一时间提醒。`
          : `预计 ${formatReminderPreview(date, allDay, startTime, reminderMinutes)} 触发。`
      }`
    : "未开启提醒，保存后不会发送本地提醒或系统推送。";
  const reminderModeDetail = reminderEnabled
    ? ownerId === "local"
      ? "当前为本地数据：应用打开时会检查提醒；登录并完成系统提醒订阅后，可在应用关闭时接收推送。"
      : "应用打开时会本地检查；账号与同步中的系统提醒订阅可让应用关闭后也由云端推送。"
      : "";

  function changeStartDate(nextDate: string) {
    setDate(nextDate);
    if (endDate < nextDate) setEndDate(nextDate);
    if (recurrenceUntil < nextDate) setRecurrenceUntil(nextDate);
  }

  async function toggleReminder(enabled: boolean) {
    setReminderMessage("");
    if (!enabled) {
      setReminderEnabled(false);
      return;
    }
    setReminderEnabled(true);
    setEnablingReminder(true);
    try {
      const result = await enableNotifications((stage) => {
        setReminderMessage({
          permission: "正在检查浏览器通知权限…",
          "service-worker": "正在启动应用后台服务…",
          "push-service": "正在连接手机系统推送服务…",
          cloud: "正在保存云端推送订阅…"
        }[stage]);
      });
      if (result === "denied") {
        setReminderEnabled(false);
        setReminderMessage("浏览器未允许通知，请在网站权限中开启后重试。");
      } else if (result === "unsupported") {
        setReminderEnabled(false);
        setReminderMessage("当前浏览器不支持系统通知。请使用 Android Chrome 或 Windows Edge/Chrome。");
      } else if (result === "local-only") {
        setReminderMessage("已启用提醒；登录并完成云端通知配置后，可在应用关闭时接收。");
      } else {
        setReminderMessage("系统提醒已启用。");
      }
    } catch (error) {
      const permissionGranted = "Notification" in window && Notification.permission === "granted";
      if (!permissionGranted) setReminderEnabled(false);
      const detail = error instanceof Error ? error.message : "通知订阅失败";
      setReminderMessage(
        permissionGranted
          ? `${detail}。${itemLabel}仍可保存；应用打开时会进行本地提醒。`
          : `${detail}。请重新启用提醒。`
      );
    } finally {
      setEnablingReminder(false);
    }
  }

  async function save(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setValidationMessage("");
    const validationError = validateEventDraft({
      title,
      startDate: date,
      endDate: recurrence === "none" ? endDate : date,
      allDay,
      startTime,
      endTime
    });
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }
    setSaving(true);
    const record: EventItem = {
      ...syncFields(eventItem),
      event_type: eventType,
      title: title.trim(),
      start_date: date,
      end_date: recurrence === "none" ? endDate : date,
      start_time: allDay ? null : startTime,
      end_time: allDay ? null : endTime,
      all_day: allDay,
      category_id: categoryId || null,
      color,
      note: note.trim(),
      recurrence_type: recurrence,
      recurrence_until: recurrence === "weekly" ? recurrenceUntil : null,
      reminder_enabled: reminderEnabled,
      reminder_minutes_before: reminderMinutes,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    await db.events.put(record);
    await queueChange("events", record.id);
    await resetSentRemindersForChangedEvent(eventItem, record);
    setSaving(false);
    onClose();
  }

  async function remove() {
    if (!eventItem || !window.confirm(`删除${itemLabel}“${eventItem.title}”？`)) return;
    await db.events.put({ ...eventItem, ...syncFields(eventItem), deleted_at: new Date().toISOString() });
    await queueChange("events", eventItem.id, "delete");
    onClose();
  }

  async function duplicate() {
    if (!eventItem) return;
    const record: EventItem = {
      ...eventItem,
      ...syncFields(),
      title: `${eventItem.title} 副本`,
      deleted_at: null
    };
    await db.events.put(record);
    await queueChange("events", record.id);
    onClose();
  }

  async function setTodayCompleted(completed: boolean) {
    if (!eventItem || !todayCompletion?.occurs) return;
    const record = buildEventCompletionRecord(eventItem, todayCompletion.occurrenceDate, completed, todayCompletion.state);
    await db.eventOccurrenceStates.put(record);
    await queueChange("eventOccurrenceStates", record.id);
    setCompletionMessage(completed ? "已标记今天完成。" : "已标记今天未完成。");
  }

  return (
    <Modal title={eventItem ? `编辑${itemLabel}` : `新增${itemLabel}`} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <label>标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="form-grid">
          <label>开始日期<input required type="date" value={date} onChange={(event) => changeStartDate(event.target.value)} /></label>
          {recurrence === "none" ? (
            <label>结束日期<input required type="date" min={date} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          ) : (
            <label>重复截止日期<input type="date" min={date} value={recurrenceUntil} onChange={(event) => setRecurrenceUntil(event.target.value)} /></label>
          )}
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />全天{itemLabel}</label>
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
            <option value="none">{eventType === "habit" ? "每天打卡" : "日期范围内每天"}</option>
            <option value="weekly">每周重复</option>
          </select>
        </label>
        {eventItem && todayCompletion && (
          <section className="event-completion-editor">
            <div>
              <strong><CalendarCheck size={17} />今日状态</strong>
              <span>
                {todayCompletion.occurs
                  ? `今天 ${todayCompletion.occurrenceDate} ${todayCompletion.completed ? "已完成" : "未完成"}`
                  : `今天 ${todayCompletion.occurrenceDate} 没有这一事项`}
              </span>
            </div>
            <button
              type="button"
              className="button secondary compact"
              disabled={!todayCompletion.occurs}
              onClick={() => void setTodayCompleted(!todayCompletion.completed)}
            >
              {todayCompletion.completed ? "标记今天未完成" : "标记今天完成"}
            </button>
            {completionMessage && <p>{completionMessage}</p>}
          </section>
        )}
        <section className="reminder-editor">
          <label className="checkbox-label">
            <input type="checkbox" checked={reminderEnabled} onChange={(event) => void toggleReminder(event.target.checked)} />
            <BellRing size={17} />提醒我
          </label>
          {reminderEnabled && (
            <label>
              提前时间
              <select value={reminderMinutes} onChange={(event) => setReminderMinutes(Number(event.target.value))}>
                <option value={0}>开始时</option>
                <option value={5}>提前 5 分钟</option>
                <option value={10}>提前 10 分钟</option>
                <option value={15}>提前 15 分钟</option>
                <option value={30}>提前 30 分钟</option>
                <option value={60}>提前 1 小时</option>
                <option value={1440}>提前 1 天</option>
              </select>
            </label>
          )}
          <p className={reminderEnabled ? "reminder-status active" : "reminder-status"}>
            <strong>{reminderEnabled ? "提醒已开启" : "提醒未开启"}</strong>
            <span>{reminderSummary}{reminderModeDetail ? ` ${reminderModeDetail}` : ""}</span>
          </p>
          {reminderMessage && <p>{reminderMessage}</p>}
        </section>
        <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {validationMessage && <p className="auth-message error">{validationMessage}</p>}
        <div className="form-actions split">
          <div className="inline-actions">
            {eventItem && <button type="button" className="button secondary" onClick={() => void duplicate()}><Copy size={16} />复制事项</button>}
            {eventItem && <button type="button" className="button danger-button" onClick={remove}>删除{itemLabel}</button>}
          </div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button className="button primary" disabled={saving || enablingReminder}>
              {saving ? "保存中…" : enablingReminder ? "正在启用提醒…" : `保存${itemLabel}`}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function formatReminderLead(minutes: number): string {
  if (minutes === 0) return "开始时";
  if (minutes === 1440) return "提前 1 天";
  if (minutes >= 60 && minutes % 60 === 0) return `提前 ${minutes / 60} 小时`;
  return `提前 ${minutes} 分钟`;
}

function formatReminderPreview(date: string, allDay: boolean, startTime: string, minutesBefore: number): string {
  const [hour, minute] = (allDay ? "09:00" : startTime).split(":").map(Number);
  const triggerAt = parseLocalDate(date);
  triggerAt.setHours(hour, minute, 0, 0);
  triggerAt.setMinutes(triggerAt.getMinutes() - minutesBefore);
  return `${toISODate(triggerAt)} ${String(triggerAt.getHours()).padStart(2, "0")}:${String(triggerAt.getMinutes()).padStart(2, "0")}`;
}
