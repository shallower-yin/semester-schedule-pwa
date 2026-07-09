import { syncFields } from "./identity";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";
import type { Anniversary, AnniversaryKind, EventItem, Memo } from "../types";

export type AiCreatedRecord =
  | { table: "events"; record: EventItem }
  | { table: "anniversaries"; record: Anniversary }
  | { table: "memos"; record: Memo };

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
    event_type: action.eventType === "habit" ? "habit" : "event",
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

export function anniversaryFromAiAction(action: DeepSeekAssistantAction, sourceText: string, ownerId: string, now = new Date()): Anniversary | null {
  if (action.type !== "create_anniversary") return null;
  const title = action.title.trim();
  const resolvedHoliday = resolveHoliday(title || sourceText, now);
  const date = action.date && isISODate(action.date) ? action.date : resolvedHoliday?.date;
  if (!title || !date) return null;
  const kind = normalizeAnniversaryKind(action.kind) ?? resolvedHoliday?.kind ?? "anniversary";
  return {
    ...syncFields(),
    user_id: ownerId,
    kind,
    title: resolvedHoliday?.title && isHolidayText(title) ? resolvedHoliday.title : title,
    date,
    color: anniversaryColor(kind),
    note: [action.note?.trim(), `由 AI 助手创建：${sourceText}`].filter(Boolean).join("\n"),
    reminder_enabled: Boolean(action.reminderEnabled),
    reminder_days_before: clampNumber(action.reminderDaysBefore, 0, 365, 0),
    reminder_time: normalizeTime(action.reminderTime) ?? "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai"
  };
}

export function memoFromAiAction(action: DeepSeekAssistantAction, sourceText: string, ownerId: string): Memo | null {
  if (action.type !== "create_memo") return null;
  const title = action.title.trim();
  if (!title) return null;
  const content = typeof action.content === "string" ? action.content.trim() : "";
  return {
    ...syncFields(),
    user_id: ownerId,
    folder_id: null,
    title,
    content: content ? `${content}\n\n由 AI 助手创建：${sourceText}` : `由 AI 助手创建：${sourceText}`,
    is_pinned: Boolean(action.isPinned)
  };
}

export function recordsFromAiActions(actions: DeepSeekAssistantAction[], sourceText: string, ownerId: string, now = new Date()): AiCreatedRecord[] {
  const expandedActions = expandHolidayActions(actions, sourceText, now);
  return expandedActions.flatMap<AiCreatedRecord>((action) => {
    const event = eventItemFromAiAction(action, sourceText, ownerId);
    if (event) return [{ table: "events" as const, record: event }];
    const anniversary = anniversaryFromAiAction(action, sourceText, ownerId, now);
    if (anniversary) return [{ table: "anniversaries" as const, record: anniversary }];
    const memo = memoFromAiAction(action, sourceText, ownerId);
    return memo ? [{ table: "memos" as const, record: memo }] : [];
  });
}

function expandHolidayActions(actions: DeepSeekAssistantAction[], sourceText: string, now: Date): DeepSeekAssistantAction[] {
  const hasAnniversary = actions.some((action) => action.type === "create_anniversary");
  if (hasAnniversary || !/(创建|新增|添加|记录|加入).*(节|春节|端午|中秋|元旦|国庆|生日|纪念日)/.test(sourceText)) return actions;
  const resolved = resolveHoliday(sourceText, now);
  if (!resolved) return actions;
  return [...actions, {
    type: "create_anniversary",
    title: resolved.title,
    kind: resolved.kind,
    date: resolved.date,
    reminderEnabled: false,
    reminderDaysBefore: 0,
    reminderTime: "09:00"
  }];
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

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value!)));
}

function normalizeAnniversaryKind(value: unknown): AnniversaryKind | null {
  return value === "anniversary" || value === "birthday" || value === "holiday" ? value : null;
}

function anniversaryColor(kind: AnniversaryKind): string {
  if (kind === "birthday") return "#ec4899";
  if (kind === "holiday") return "#10b981";
  return "#f59e0b";
}

interface ResolvedHoliday {
  title: string;
  kind: "holiday";
  date: string;
}

const SOLAR_HOLIDAYS: Array<{ names: string[]; title: string; month: number; day: number }> = [
  { names: ["元旦"], title: "元旦", month: 1, day: 1 },
  { names: ["情人节"], title: "情人节", month: 2, day: 14 },
  { names: ["妇女节", "三八"], title: "妇女节", month: 3, day: 8 },
  { names: ["植树节"], title: "植树节", month: 3, day: 12 },
  { names: ["劳动节", "五一"], title: "劳动节", month: 5, day: 1 },
  { names: ["青年节"], title: "青年节", month: 5, day: 4 },
  { names: ["儿童节", "六一"], title: "儿童节", month: 6, day: 1 },
  { names: ["建军节"], title: "建军节", month: 8, day: 1 },
  { names: ["教师节"], title: "教师节", month: 9, day: 10 },
  { names: ["国庆节", "国庆"], title: "国庆节", month: 10, day: 1 },
  { names: ["平安夜"], title: "平安夜", month: 12, day: 24 },
  { names: ["圣诞节", "圣诞"], title: "圣诞节", month: 12, day: 25 }
];

const LUNAR_HOLIDAYS: Array<{ names: string[]; title: string; month: string; day: number }> = [
  { names: ["春节", "农历新年", "过年"], title: "春节", month: "正月", day: 1 },
  { names: ["元宵节", "元宵"], title: "元宵节", month: "正月", day: 15 },
  { names: ["端午节", "端午"], title: "端午节", month: "五月", day: 5 },
  { names: ["七夕节", "七夕"], title: "七夕节", month: "七月", day: 7 },
  { names: ["中秋节", "中秋"], title: "中秋节", month: "八月", day: 15 },
  { names: ["重阳节", "重阳"], title: "重阳节", month: "九月", day: 9 },
  { names: ["腊八节", "腊八"], title: "腊八节", month: "腊月", day: 8 }
];

export function resolveHoliday(text: string, now = new Date()): ResolvedHoliday | null {
  const normalized = text.replace(/\s+/g, "");
  const year = extractYear(normalized, now);
  const solar = SOLAR_HOLIDAYS.find((holiday) => holiday.names.some((name) => normalized.includes(name)));
  if (solar) return { title: solar.title, kind: "holiday", date: formatDate(year, solar.month, solar.day) };

  if (/(除夕|大年三十)/.test(normalized)) {
    const spring = lunarDateInGregorianYear(year, "正月", 1);
    if (!spring) return null;
    const date = new Date(`${spring}T00:00:00+08:00`);
    date.setDate(date.getDate() - 1);
    return { title: "除夕", kind: "holiday", date: toISODateInBeijing(date) };
  }

  const lunar = LUNAR_HOLIDAYS.find((holiday) => holiday.names.some((name) => normalized.includes(name)));
  if (!lunar) return null;
  const date = lunarDateInGregorianYear(year, lunar.month, lunar.day);
  return date ? { title: lunar.title, kind: "holiday", date } : null;
}

function isHolidayText(text: string): boolean {
  return Boolean(resolveHoliday(text));
}

function extractYear(text: string, now: Date): number {
  const explicit = /(\d{4})年/.exec(text)?.[1];
  if (explicit) return Number(explicit);
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now));
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lunarDateInGregorianYear(year: number, monthName: string, day: number): string | null {
  const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const start = new Date(`${year}-01-01T00:00:00+08:00`);
  const end = new Date(`${year}-12-31T00:00:00+08:00`);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const parts = formatter.formatToParts(cursor);
    const relatedYear = parts.find((part) => String(part.type) === "relatedYear")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const dayText = parts.find((part) => part.type === "day")?.value;
    if (relatedYear === String(year) && month === monthName && Number(dayText) === day) {
      return toISODateInBeijing(cursor);
    }
  }
  return null;
}

function toISODateInBeijing(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
