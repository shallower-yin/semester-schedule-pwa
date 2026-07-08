import { syncFields } from "./identity";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";
import type { EventItem } from "../types";

export function eventItemFromAiAction(action: DeepSeekAssistantAction, sourceText: string, ownerId: string): EventItem | null {
  if (action.type !== "create_event") return null;
  const title = action.title.trim();
  if (!title || !isISODate(action.startDate)) return null;
  const allDay = Boolean(action.allDay || !action.startTime);
  const startTime = allDay ? null : normalizeTime(action.startTime) ?? "09:00";
  const endTime = allDay ? null : normalizeTime(action.endTime) ?? startTime;
  const endDate = action.endDate && isISODate(action.endDate) ? action.endDate : action.startDate;
  return {
    ...syncFields(),
    user_id: ownerId,
    event_type: "event",
    title,
    start_date: action.startDate,
    end_date: endDate < action.startDate ? action.startDate : endDate,
    start_time: startTime,
    end_time: endTime,
    all_day: allDay,
    category_id: null,
    color: "#e36b32",
    note: [action.note?.trim(), `由 AI 助手创建：${sourceText}`].filter(Boolean).join("\n"),
    recurrence_type: "none",
    recurrence_until: null,
    recurrence_interval: 1,
    reminder_enabled: Boolean(action.reminderEnabled),
    reminder_minutes_before: clampReminder(action.reminderMinutesBefore),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
  };
}

function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clampReminder(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(7 * 24 * 60, Math.max(0, Math.round(value!)));
}
