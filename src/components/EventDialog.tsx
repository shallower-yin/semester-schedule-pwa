import { useLiveQuery } from "dexie-react-hooks";
import { BellRing, CalendarCheck, Copy, FileText } from "lucide-react";
import { useState } from "react";
import { db, queueChange } from "../db";
import { uniqueCategoriesByName } from "../lib/categories";
import { findEventConflicts, findEventCourseConflicts } from "../lib/conflicts";
import { addDays, parseLocalDate, toISODate } from "../lib/date";
import { buildEventCompletionRecord, eventCompletionForDate } from "../lib/eventCompletion";
import { validateEventDraft } from "../lib/eventValidation";
import { deleteEventTemplate, loadEventTemplates, saveEventTemplate } from "../lib/eventTemplates";
import { hardDeleteEventsCascade } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { enableNotifications, resetSentRemindersForChangedEvent } from "../lib/notifications";
import { showToast } from "../lib/toast";
import type { EventItem, EventOccurrenceState, EventRecurrenceType, EventType, Memo } from "../types";
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
  const [location, setLocation] = useState(eventItem?.location ?? "");
  const [note, setNote] = useState(eventItem?.note ?? "");
  const [recurrence, setRecurrence] = useState<EventRecurrenceType>(eventItem?.recurrence_type ?? "none");
  const [recurrenceUntil, setRecurrenceUntil] = useState(eventItem?.recurrence_until ?? eventItem?.start_date ?? initialDate);
  const [recurrenceInterval, setRecurrenceInterval] = useState(eventItem?.recurrence_interval ?? 1);
  const [reminderEnabled, setReminderEnabled] = useState(eventItem?.reminder_enabled ?? false);
  const [reminderMinutes, setReminderMinutes] = useState(eventItem?.reminder_minutes_before ?? 10);
  const [reminderMessage, setReminderMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [completionMessage, setCompletionMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [suggestedSlot, setSuggestedSlot] = useState<{ date: string; startTime: string; endTime: string } | null>(null);
  const [templates, setTemplates] = useState(() => loadEventTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
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

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setTitle(template.title);
    setStartTime(template.start_time ?? "09:00");
    setEndTime(template.end_time ?? template.start_time ?? "10:00");
    setAllDay(template.all_day);
    setCategoryId(template.category_id ?? "");
    setColor(template.color);
    setLocation(template.location ?? "");
    setNote(template.note);
    setRecurrence(template.recurrence_type);
    setRecurrenceInterval(template.recurrence_interval);
    setReminderEnabled(template.reminder_enabled);
    setReminderMinutes(template.reminder_minutes_before);
  }

  function saveCurrentTemplate() {
    if (!title.trim()) {
      setValidationMessage("请先填写标题，再保存模板。");
      return;
    }
    const name = window.prompt("模板名称", title.trim());
    if (!name?.trim()) return;
    saveEventTemplate({
      name: name.trim(),
      event_type: eventType,
      title: title.trim(),
      start_time: allDay ? null : startTime,
      end_time: allDay ? null : endTime,
      all_day: allDay,
      category_id: categoryId || null,
      color,
      location: location.trim(),
      note: note.trim(),
      recurrence_type: recurrence,
      recurrence_interval: Math.max(1, recurrenceInterval),
      reminder_enabled: reminderEnabled,
      reminder_minutes_before: reminderMinutes
    });
    setTemplates(loadEventTemplates());
  }

  function removeSelectedTemplate() {
    if (!selectedTemplateId) return;
    deleteEventTemplate(selectedTemplateId);
    setSelectedTemplateId("");
    setTemplates(loadEventTemplates());
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
        setReminderMessage("当前浏览器不支持系统通知。请使用 Android Edge/Chrome 或 Windows Edge/Chrome。");
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
    setSuggestedSlot(null);
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
      location: location.trim(),
      note: note.trim(),
      recurrence_type: recurrence,
      recurrence_until: recurrence === "none" ? null : recurrenceUntil,
      recurrence_interval: recurrence === "interval" ? Math.max(1, recurrenceInterval) : 1,
      reminder_enabled: reminderEnabled,
      reminder_minutes_before: reminderMinutes,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    const existingEvents = await db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
    const currentSemester = await db.semesters.filter((item) => item.user_id === ownerId && item.is_current && !item.deleted_at).first();
    const courseConflicts = currentSemester
      ? await collectCourseConflicts(record, currentSemester.id)
      : [];
    const conflicts = [...findEventConflicts(record, existingEvents), ...courseConflicts].slice(0, 5);
    if (conflicts.length) {
      const message = `可能与 ${conflicts.map((item) => `“${item.title}”(${item.detail})`).join("、")} 重叠。仍然保存？`;
      if (!window.confirm(message)) {
        setConflictMessage(message);
        setSuggestedSlot(await findNextAvailableSlot(record, existingEvents, currentSemester?.id));
        setSaving(false);
        return;
      }
    }
    await db.events.put(record);
    await queueChange("events", record.id);
    await resetSentRemindersForChangedEvent(eventItem, record);
    setSaving(false);
    onClose();
  }

  async function findNextAvailableSlot(record: EventItem, existingEvents: EventItem[], semesterId?: string): Promise<{ date: string; startTime: string; endTime: string } | null> {
    if (record.all_day) return null;
    const duration = Math.max(30, minutesBetween(record.start_time ?? "09:00", record.end_time ?? record.start_time ?? "10:00"));
    const start = parseLocalDate(record.start_date);
    for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
      const candidateDate = toISODate(addDays(start, dayOffset));
      for (let minute = 8 * 60; minute <= 22 * 60 - duration; minute += 30) {
        const candidate: EventItem = {
          ...record,
          start_date: candidateDate,
          end_date: candidateDate,
          start_time: formatMinutes(minute),
          end_time: formatMinutes(minute + duration),
          recurrence_type: "none",
          recurrence_until: null
        };
        const eventConflicts = findEventConflicts(candidate, existingEvents);
        const courseConflicts = semesterId ? await collectCourseConflicts(candidate, semesterId) : [];
        if (!eventConflicts.length && !courseConflicts.length) {
          return { date: candidateDate, startTime: candidate.start_time ?? "09:00", endTime: candidate.end_time ?? "10:00" };
        }
      }
    }
    return null;
  }

  function applySuggestedSlot() {
    if (!suggestedSlot) return;
    setDate(suggestedSlot.date);
    setEndDate(suggestedSlot.date);
    setStartTime(suggestedSlot.startTime);
    setEndTime(suggestedSlot.endTime);
    setRecurrence("none");
    setSuggestedSlot(null);
    setConflictMessage("");
  }

  async function collectCourseConflicts(record: EventItem, semesterId: string) {
    const currentSemester = await db.semesters.get(semesterId);
    if (!currentSemester) return [];
    const courses = await db.courses.where("semester_id").equals(semesterId).filter((item) => !item.deleted_at).toArray();
    const courseIds = new Set(courses.map((item) => item.id));
    const schedules = await db.courseSchedules.filter((item) => courseIds.has(item.course_id) && !item.deleted_at).toArray();
    const periods = await db.classPeriods.where("semester_id").equals(semesterId).filter((item) => !item.deleted_at && item.kind !== "break").toArray();
    return findEventCourseConflicts(record, currentSemester, courses, schedules, periods);
  }

  async function remove() {
    if (!eventItem || !window.confirm(`确定彻底删除${itemLabel}“${eventItem.title}”吗？相关完成状态和提醒记录会一并删除，且无法恢复。`)) return;
    await hardDeleteEventsCascade([eventItem.id]);
    showToast(`已彻底删除${itemLabel}。`, "success");
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
    showToast(`已复制${itemLabel}。`, "success");
    onClose();
  }

  async function setTodayCompleted(completed: boolean) {
    if (!eventItem || !todayCompletion?.occurs) return;
    const record = buildEventCompletionRecord(eventItem, todayCompletion.occurrenceDate, completed, todayCompletion.state);
    await db.eventOccurrenceStates.put(record);
    await queueChange("eventOccurrenceStates", record.id);
    setCompletionMessage(completed ? "已标记今天完成。" : "已标记今天未完成。");
    showToast(completed ? "已标记今天完成。" : "已标记今天未完成。", "success");
  }

  async function createMemoFromEvent() {
    const record: Memo = {
      ...syncFields(),
      folder_id: null,
      title: title.trim() || "未命名事项",
      content: [
        `日期：${date}${endDate !== date ? ` 至 ${endDate}` : ""}`,
        allDay ? "时间：全天" : `时间：${startTime}-${endTime}`,
        location.trim() ? `地点：${location.trim()}` : "",
        note.trim()
      ].filter(Boolean).join("\n"),
      is_pinned: false
    };
    await db.memos.put(record);
    await queueChange("memos", record.id);
    setCompletionMessage("已转为备忘录。");
    showToast("已转为备忘录。", "success");
  }

  return (
    <Modal title={eventItem ? `编辑${itemLabel}` : `新增${itemLabel}`} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <label>标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="template-toolbar">
          <label>模板
            <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">不使用模板</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <button type="button" className="button secondary compact" onClick={saveCurrentTemplate}>保存为模板</button>
          <button type="button" className="button secondary compact" disabled={!selectedTemplateId} onClick={removeSelectedTemplate}>删除模板</button>
        </div>
        <div className="form-grid">
          <label>开始日期<input required type="date" value={date} onChange={(event) => changeStartDate(event.target.value)} /></label>
          {recurrence === "none" ? (
            <label>结束日期<input required type="date" min={date} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          ) : (
            <label>重复截止日期<input required type="date" min={date} value={recurrenceUntil} onChange={(event) => setRecurrenceUntil(event.target.value)} /></label>
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
        <label>地点<input value={location} placeholder="可不填" onChange={(event) => setLocation(event.target.value)} /></label>
        <label>重复
          <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as EventRecurrenceType)}>
            <option value="none">{eventType === "habit" ? "每天打卡" : "日期范围内每天"}</option>
            <option value="daily">每天重复</option>
            <option value="weekdays">工作日重复</option>
            <option value="weekly">每周重复</option>
            <option value="monthly">每月同日重复</option>
            <option value="interval">自定义间隔天数</option>
          </select>
        </label>
        {recurrence === "interval" && (
          <label>间隔天数<input type="number" min={1} max={366} value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(Number(event.target.value))} /></label>
        )}
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
                <option value={4320}>提前 3 天</option>
                <option value={7200}>提前 5 天</option>
                <option value={10080}>提前 7 天</option>
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
        {conflictMessage && (
          <div className="auth-message conflict-suggestion">
            <p>{conflictMessage}</p>
            {suggestedSlot ? (
              <button type="button" className="button secondary compact" onClick={applySuggestedSlot}>
                改到 {suggestedSlot.date} {suggestedSlot.startTime}-{suggestedSlot.endTime}
              </button>
            ) : <span>暂未找到接下来两周内的空闲时间。</span>}
          </div>
        )}
        <div className="form-actions split">
          <div className="inline-actions">
            {eventItem && <button type="button" className="button secondary" onClick={() => void duplicate()}><Copy size={16} />复制事项</button>}
            <button type="button" className="button secondary" onClick={() => void createMemoFromEvent()}><FileText size={16} />转备忘录</button>
            {eventItem && <button type="button" className="button danger-button" onClick={remove}>彻底删除{itemLabel}</button>}
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
  if (minutes >= 1440 && minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`;
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

function minutesBetween(start: string, end: string): number {
  return Math.max(0, minutesOf(end) - minutesOf(start));
}

function minutesOf(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
