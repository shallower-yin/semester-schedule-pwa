import { syncFields } from "./identity";
import type { AnniversaryUpdateScope, DeepSeekAssistantAction } from "./deepSeekAssistant";
import type { Anniversary, AnniversaryCalendarType, AnniversaryKind, EventItem, EventRecurrenceType, Memo } from "../types";
import { gregorianDateForLunarDate, lunarDateParts, lunarOccurrenceDates, lunarYearEndDate, lunarYearEndOccurrenceDates, qingmingDateForYear, LUNAR_MONTHS } from "./lunarCalendar";

export type AiCreatedRecord =
  | { table: "events"; record: EventItem }
  | { table: "anniversaries"; record: Anniversary }
  | { table: "memos"; record: Memo };

export type AiUpdatedRecord = { original: EventItem; updated: EventItem };
export type AiUpdatedAnniversaryRecord = { original: Anniversary; updated: Anniversary };

export interface AiUnmatchedAction {
  action: "update" | "delete";
  title: string;
}

export interface AiActionResults {
  created: AiCreatedRecord[];
  updated: Array<AiUpdatedRecord | AiUpdatedAnniversaryRecord>;
  deleted: EventItem[];
  unmatched: AiUnmatchedAction[];
}

export function inferAnniversaryUpdateAction(sourceText: string): Extract<DeepSeekAssistantAction, { type: "update_anniversary" }> | null {
  const normalized = sourceText.replace(/\s+/g, "");
  const requestsUpdate = /(改成|改为|转换成|转换为|调整为|设为)/.test(normalized);
  const requestsAll = /(全部|所有|批量)/.test(normalized);
  if (requestsUpdate && requestsAll && /(农历节日|传统节日)/.test(normalized) && /农历/.test(normalized)) {
    return { type: "update_anniversary", scope: "all_lunar_holidays", calendarType: "lunar" };
  }
  return null;
}

/**
 * Match existing events by title, optionally narrowed to a single date.
 *
 * Exact (case/space/punctuation-insensitive) matches win. When there is no exact
 * match, a partial match is accepted only if it points at exactly one distinct
 * title, so a vague name cannot silently rewrite or delete unrelated records.
 */
export function matchEventsByTitle(events: EventItem[], title: string, date?: string | null): EventItem[] {
  const target = normalizeEventTitle(title);
  if (!target) return [];
  const candidates = events.filter((event) => {
    if (event.deleted_at) return false;
    if (date && event.start_date !== date && event.end_date !== date) return false;
    return true;
  });
  const exact = candidates.filter((event) => normalizeEventTitle(event.title) === target);
  if (exact.length) return exact;
  const partial = candidates.filter((event) => {
    const candidate = normalizeEventTitle(event.title);
    return Boolean(candidate) && (candidate.includes(target) || target.includes(candidate));
  });
  const distinctTitles = new Set(partial.map((event) => normalizeEventTitle(event.title)));
  return distinctTitles.size === 1 ? partial : [];
}

function normalizeEventTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[\s·・,，、.。:：;；!！?？'"“”‘’()（）\-—_/\\]/g, "");
}

/**
 * Merge an AI update into an existing event.
 *
 * The model sends `null` for every field it is not changing, so `null` must mean
 * "leave as is". Time handling follows the editor's rules: an explicit time makes
 * the item timed, `allDay: true` clears the times, and a timed item always keeps a
 * usable start/end pair.
 */
export function applyEventUpdate(original: EventItem, action: Extract<DeepSeekAssistantAction, { type: "update_event" }>, sourceText = ""): EventItem {
  const next: EventItem = { ...original };
  const source = anniversaryDateSource(sourceText, action.title);
  const sourceLunar = resolveLunarDateFromText(source, new Date());
  if (hasExplicitLunarDate(source) && !sourceLunar) throw new Error(`“${original.title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
  if (action.newTitle?.trim()) next.title = action.newTitle.trim();
  if (sourceLunar) {
    next.start_date = sourceLunar.date;
    if (!action.endDate || action.endDate === action.startDate) next.end_date = sourceLunar.date;
  } else if (action.startDate) next.start_date = action.startDate;
  if (action.endDate && (!sourceLunar || action.endDate !== action.startDate)) next.end_date = action.endDate;
  if (typeof action.location === "string") next.location = action.location;
  if (typeof action.note === "string") next.note = action.note;
  if (typeof action.reminderEnabled === "boolean") next.reminder_enabled = action.reminderEnabled;
  if (typeof action.reminderMinutesBefore === "number") next.reminder_minutes_before = action.reminderMinutesBefore;

  if (action.allDay === true) {
    next.all_day = true;
    next.start_time = null;
    next.end_time = null;
  } else if (action.allDay === false || action.startTime) {
    const startTime = action.startTime ?? original.start_time ?? "09:00";
    next.all_day = false;
    next.start_time = startTime;
    next.end_time = action.endTime ?? (original.end_time && original.end_time >= startTime ? original.end_time : startTime);
  } else if (action.endTime) {
    next.end_time = action.endTime;
  }

  if (next.end_date < next.start_date) next.end_date = next.start_date;
  return next;
}

export function matchAnniversariesByAction(
  anniversaries: Anniversary[],
  action: Extract<DeepSeekAssistantAction, { type: "update_anniversary" }>
): Anniversary[] {
  const candidates = anniversaries.filter((item) => !item.deleted_at && (!action.kind || item.kind === action.kind));
  if (action.scope === "all_lunar_holidays") {
    return candidates.filter((item) => item.kind === "holiday" && Boolean(knownLunarHoliday(item.title)));
  }
  if (action.scope === "all_holidays") return candidates.filter((item) => item.kind === "holiday");
  const target = normalizeEventTitle(action.title ?? "");
  if (!target) return [];
  const exact = candidates.filter((item) => normalizeEventTitle(item.title) === target);
  if (exact.length) return exact;
  const partial = candidates.filter((item) => {
    const candidate = normalizeEventTitle(item.title);
    return Boolean(candidate) && (candidate.includes(target) || target.includes(candidate));
  });
  const distinctTitles = new Set(partial.map((item) => normalizeEventTitle(item.title)));
  return distinctTitles.size === 1 ? partial : [];
}

export function applyAnniversaryUpdate(
  original: Anniversary,
  action: Extract<DeepSeekAssistantAction, { type: "update_anniversary" }>,
  sourceText = ""
): Anniversary {
  const next: Anniversary = { ...original };
  if (action.newTitle?.trim()) next.title = action.newTitle.trim();
  if (typeof action.reminderEnabled === "boolean") next.reminder_enabled = action.reminderEnabled;
  if (typeof action.reminderDaysBefore === "number") next.reminder_days_before = clampNumber(action.reminderDaysBefore, 0, 365, next.reminder_days_before);
  if (typeof action.reminderTime === "string") next.reminder_time = normalizeTime(action.reminderTime) ?? next.reminder_time;
  const source = anniversaryDateSource(sourceText, action.title ?? next.title);
  const sourceLunar = resolveLunarDateFromText(source, new Date(), action.lunarYear ?? next.lunar_year ?? inferLunarYear(next))
    ?? (!knownLunarHoliday(next.title) && isSolarToLunarConversion(source) && isISODate(original.date) ? lunarFieldsFromGregorianDate(original.date) : null);
  if (hasExplicitLunarDate(source) && !sourceLunar) throw new Error(`“${next.title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
  const hasLunarFields = action.lunarYear != null || action.lunarMonth != null || action.lunarDay != null || action.lunarIsLeapMonth != null;
  if (!sourceLunar && (action.calendarType === "solar" || (action.date && !hasLunarFields && !action.calendarType && next.calendar_type !== "lunar"))) {
    const date = action.date && isISODate(action.date) ? action.date : next.date;
    next.calendar_type = "solar";
    next.date = date;
    next.lunar_year = null;
    next.lunar_month = null;
    next.lunar_day = null;
    next.lunar_is_leap_month = false;
    next.lunar_occurrence_dates = [];
    if (next.date !== original.date || next.calendar_type !== original.calendar_type || next.lunar_year !== original.lunar_year || next.lunar_month !== original.lunar_month || next.lunar_day !== original.lunar_day || next.lunar_is_leap_month !== original.lunar_is_leap_month) next.reminder_sent_for = null;
    return next;
  }
  if (sourceLunar || action.calendarType === "lunar" || action.scope === "all_lunar_holidays" || hasLunarFields) {
    const known = knownLunarHoliday(next.title);
    const lunarYear = sourceLunar?.lunarYear ?? action.lunarYear ?? next.lunar_year ?? inferLunarYear(next);
    // A repair of known holidays must not inherit the dates from a bad migration.
    const lunarMonth = sourceLunar?.lunarMonth ?? (action.scope === "all_lunar_holidays" ? known?.month : action.lunarMonth) ?? known?.month ?? next.lunar_month ?? null;
    const lunarDay = sourceLunar?.lunarDay ?? (action.scope === "all_lunar_holidays" ? known?.day : action.lunarDay) ?? known?.day ?? next.lunar_day ?? null;
    if (!lunarYear || !lunarMonth || !lunarDay) throw new Error(`请明确“${next.title}”的农历年月日后再修改。`);
    const isLeapMonth = sourceLunar?.lunarIsLeapMonth ?? (known && action.scope === "all_lunar_holidays" ? false : action.lunarIsLeapMonth ?? Boolean(next.lunar_is_leap_month));
    const yearEnd = next.kind === "holiday" && isLunarYearEnd(next.title);
    const date = yearEnd ? lunarYearEndDate(lunarYear) : gregorianDateForLunarDate(lunarYear, lunarMonth, lunarDay, isLeapMonth);
    if (!date) throw new Error(`“${next.title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
    next.calendar_type = "lunar";
    next.date = date;
    next.lunar_year = lunarYear;
    next.lunar_month = lunarMonth;
    next.lunar_day = yearEnd ? lunarDateParts(new Date(`${date}T12:00:00+08:00`)).day : lunarDay;
    next.lunar_is_leap_month = yearEnd ? false : isLeapMonth;
    next.lunar_occurrence_dates = yearEnd ? lunarYearEndOccurrenceDates(lunarYear) : lunarOccurrenceDates(lunarYear, lunarMonth, lunarDay, isLeapMonth);
  }
  if (next.date !== original.date || next.calendar_type !== original.calendar_type || next.lunar_year !== original.lunar_year || next.lunar_month !== original.lunar_month || next.lunar_day !== original.lunar_day || next.lunar_is_leap_month !== original.lunar_is_leap_month) next.reminder_sent_for = null;
  return next;
}

export function eventItemFromAiAction(action: DeepSeekAssistantAction, sourceText: string, ownerId: string, now?: Date): EventItem | null {
  if (action.type !== "create_event") return null;
  const title = action.title.trim();
  const source = anniversaryDateSource(sourceText, title);
  const sourceLunar = resolveLunarDateFromText(source, now ?? new Date());
  if (hasExplicitLunarDate(source) && !sourceLunar) throw new Error(`“${title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
  const startDate = sourceLunar?.date ?? action.startDate;
  if (!title || !isISODate(startDate)) return null;
  const allDay = Boolean(action.allDay || !action.startTime);
  const startTime = allDay ? null : normalizeTime(action.startTime) ?? "09:00";
  let endTime = allDay ? null : normalizeTime(action.endTime) ?? startTime;
  let rangeEndDate = action.endDate && isISODate(action.endDate) && (!sourceLunar || action.endDate !== action.startDate) ? action.endDate : startDate;
  let recurrenceType = normalizeRecurrenceType(action.recurrenceType);
  if (/(第一天|当天|只(?:创建|安排|放在).*一天|不要每天|短时间(?:的)?事项)/.test(sourceText)) {
    rangeEndDate = startDate;
    recurrenceType = "none";
  }
  if (/短时间/.test(sourceText) && startTime && endTime === startTime) {
    endTime = addMinutesToTime(startTime, 30);
  }
  const recurrenceUntil = recurrenceType === "none"
    ? null
    : normalizeDate(action.recurrenceUntil) ?? rangeEndDate;
  return {
    ...syncFields(undefined, ownerId),
    event_type: action.eventType === "habit" ? "habit" : "event",
    title,
    start_date: startDate,
    end_date: recurrenceType === "none" ? (rangeEndDate < startDate ? startDate : rangeEndDate) : startDate,
    start_time: startTime,
    end_time: endTime,
    all_day: allDay,
    category_id: null,
    color: "#e36b32",
    location: typeof action.location === "string" ? action.location.trim().slice(0, 200) : "",
    note: conciseAiNote(action.note),
    recurrence_type: recurrenceType,
    recurrence_until: recurrenceType === "none" ? null : (recurrenceUntil && recurrenceUntil >= startDate ? recurrenceUntil : startDate),
    recurrence_interval: recurrenceType === "interval" ? clampNumber(action.recurrenceInterval, 1, 366, 1) : 1,
    reminder_enabled: Boolean(action.reminderEnabled) && !(now && eventStartHasPassed(startDate, startTime, now)),
    reminder_minutes_before: clampReminder(action.reminderMinutesBefore),
    timezone: "Asia/Shanghai"
  };
}

function addMinutesToTime(value: string, amount: number): string {
  const [hour, minute] = value.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, hour * 60 + minute + amount);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function anniversaryFromAiAction(action: DeepSeekAssistantAction, sourceText: string, ownerId: string, now = new Date()): Anniversary | null {
  if (action.type !== "create_anniversary") return null;
  const title = action.title.trim();
  const source = anniversaryDateSource(sourceText, title);
  const year = explicitYear(source)
    ?? (action.lunarYear ? action.lunarYear + (knownLunarHoliday(title)?.month === 12 ? 1 : 0) : null)
    ?? (action.date && isISODate(action.date) ? Number(action.date.slice(0, 4)) : extractYear(source, now));
  const resolvedHoliday = action.kind === "holiday" || isExactHolidayTitle(title)
    ? resolveHoliday(`${year}年${title}`, now)
    : null;
  const knownSolarHoliday = resolvedHoliday?.calendarType === "solar";
  // A model-generated title may not identify any one date in a multi-date
  // request. Keep the user's lunar intent when that binding failed, including
  // when the model returns solar/null fields or a plausible guessed lunar date.
  if (!source && /(农历|阴历|旧历)/.test(sourceText) && !isExactHolidayTitle(title)) {
    throw new Error(`无法确定“${title}”对应哪一个农历日期，请确认该日子的农历年月日。`);
  }
  const sourceLunar = knownSolarHoliday ? null : resolveLunarDateFromText(source, now, action.lunarYear ?? undefined);
  if (!knownSolarHoliday && hasExplicitLunarDate(source) && !sourceLunar) throw new Error(`“${title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
  const actionLunar = action.calendarType === "lunar" && action.lunarMonth && action.lunarDay
    ? {
      lunarYear: action.lunarYear ?? explicitYear(source) ?? lunarDateParts(now).relatedYear,
      lunarMonth: action.lunarMonth,
      lunarDay: action.lunarDay,
      lunarIsLeapMonth: Boolean(action.lunarIsLeapMonth)
    }
    : null;
  const lunarFields = knownSolarHoliday ? null : sourceLunar ?? (resolvedHoliday?.calendarType === "lunar" ? resolvedHoliday : actionLunar);
  // Never accept a solar fallback when the user or the model explicitly asked
  // for lunar dates but could not supply a valid one.
  if (!lunarFields && resolvedHoliday?.calendarType !== "solar" && (action.calendarType === "lunar" || /(农历|阴历|旧历)/.test(source))) {
    throw new Error(`请明确“${title}”的有效农历年月日后再创建。`);
  }
  const calendarType: AnniversaryCalendarType = lunarFields ? "lunar" : "solar";
  const lunarYear = lunarFields?.lunarYear ?? null;
  const lunarMonth = lunarFields?.lunarMonth ?? null;
  const lunarDay = lunarFields?.lunarDay ?? null;
  const lunarIsLeapMonth = lunarFields?.lunarIsLeapMonth ?? false;
  const yearEnd = resolvedHoliday?.title === "除夕";
  const lunarDate = lunarYear && lunarMonth && lunarDay
    ? yearEnd ? lunarYearEndDate(lunarYear) : gregorianDateForLunarDate(lunarYear, lunarMonth, lunarDay, lunarIsLeapMonth)
    : null;
  const date = calendarType === "lunar"
    ? lunarDate
    : knownSolarHoliday ? resolvedHoliday.date : action.date && isISODate(action.date) ? action.date : resolvedHoliday?.date;
  if (calendarType === "lunar" && !date) throw new Error(`“${title}”的农历日期不存在，请核对年份、月份、日期和闰月。`);
  if (!title || !date) return null;
  const kind = normalizeAnniversaryKind(action.kind) ?? resolvedHoliday?.kind ?? "anniversary";
  return {
    ...syncFields(undefined, ownerId),
    kind,
    title: resolvedHoliday?.title && isHolidayText(title) ? resolvedHoliday.title : title,
    date,
    calendar_type: calendarType,
    lunar_year: calendarType === "lunar" ? lunarYear : null,
    lunar_month: calendarType === "lunar" ? lunarMonth : null,
    lunar_day: calendarType === "lunar" ? yearEnd ? lunarDateParts(new Date(`${date}T12:00:00+08:00`)).day : lunarDay : null,
    lunar_is_leap_month: calendarType === "lunar" && lunarIsLeapMonth,
    lunar_occurrence_dates: calendarType === "lunar"
      ? yearEnd ? lunarYearEndOccurrenceDates(lunarYear!) : lunarOccurrenceDates(lunarYear!, lunarMonth!, lunarDay!, lunarIsLeapMonth)
      : [],
    color: anniversaryColor(kind),
    note: conciseAiNote(action.note),
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
    ...syncFields(undefined, ownerId),
    folder_id: null,
    title,
    content,
    is_pinned: Boolean(action.isPinned)
  };
}

export function recordsFromAiActions(actions: DeepSeekAssistantAction[], sourceText: string, ownerId: string, now = new Date()): AiCreatedRecord[] {
  const expandedActions = expandHolidayActions(actions, sourceText, now);
  return expandedActions.flatMap<AiCreatedRecord>((action) => {
    const event = eventItemFromAiAction(action, sourceText, ownerId, now);
    if (event) return [{ table: "events" as const, record: event }];
    const anniversary = anniversaryFromAiAction(action, sourceText, ownerId, now);
    if (anniversary) return [{ table: "anniversaries" as const, record: anniversary }];
    const memo = memoFromAiAction(action, sourceText, ownerId);
    return memo ? [{ table: "memos" as const, record: memo }] : [];
  });
}

function expandHolidayActions(actions: DeepSeekAssistantAction[], sourceText: string, now: Date): DeepSeekAssistantAction[] {
  if (!looksLikeCreateDate(sourceText)) return actions;
  const resolved = resolveHolidays(sourceText, now);
  if (!resolved.length) return actions;
  const existing = new Set(actions
    .filter((action) => action.type === "create_anniversary")
    .flatMap((action) => {
      const matchedHoliday = resolveHoliday(action.title, now);
      return [
        action.title.trim(),
        action.date ?? "",
        matchedHoliday?.title ?? "",
        matchedHoliday?.date ?? ""
      ];
    })
    .filter(Boolean));
  const generated = resolved
    .filter((holiday) => !existing.has(holiday.title) && !existing.has(holiday.date))
    .map<DeepSeekAssistantAction>((holiday) => ({
      type: "create_anniversary",
      title: holiday.title,
      kind: holiday.kind,
      date: holiday.date,
      calendarType: holiday.calendarType,
      lunarYear: holiday.lunarYear,
      lunarMonth: holiday.lunarMonth,
      lunarDay: holiday.lunarDay,
      lunarIsLeapMonth: holiday.lunarIsLeapMonth,
      reminderEnabled: false,
      reminderDaysBefore: 0,
      reminderTime: "09:00"
    }));
  return [...actions, ...generated].slice(0, 20);
}

function eventStartHasPassed(startDate: string, startTime: string | null, now: Date): boolean {
  const start = new Date(`${startDate}T${startTime ?? "00:00"}:00+08:00`);
  return Number.isFinite(start.getTime()) && start.getTime() < now.getTime();
}

function conciseAiNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^由\s*AI\s*助手创建[：:]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function looksLikeCreateDate(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (!/(创建|新增|添加|记录|加入)/.test(normalized)) return false;
  return /(节|春节|端午|中秋|元旦|国庆|清明|除夕|大年三十|元宵|七夕|重阳|腊八|圣诞|平安夜|情人|劳动|五一|教师|儿童|母亲|父亲|生日|纪念日)/.test(normalized);
}

function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function normalizeDate(value: string | null | undefined): string | null {
  return value && isISODate(value) ? value : null;
}

function normalizeRecurrenceType(value: unknown): EventRecurrenceType {
  return value === "daily"
    || value === "weekdays"
    || value === "weekly"
    || value === "monthly"
    || value === "interval"
    ? value
    : "none";
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
  kind: AnniversaryKind;
  date: string;
  calendarType: AnniversaryCalendarType;
  lunarYear?: number;
  lunarMonth?: number;
  lunarDay?: number;
  lunarIsLeapMonth?: boolean;
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

export function knownLunarHoliday(title: string): { month: number; day: number } | null {
  const normalized = title.replace(/\s+/g, "");
  if (isLunarYearEnd(normalized)) return { month: 12, day: 30 };
  const holiday = LUNAR_HOLIDAYS.find((item) => item.names.some((name) => normalized.includes(name)));
  if (!holiday) return null;
  return {
    month: LUNAR_MONTHS.indexOf(holiday.month as typeof LUNAR_MONTHS[number]) + 1,
    day: holiday.day
  };
}

function isLunarYearEnd(title: string): boolean {
  return /^(?:\d{4}年)?(?:除夕|大年三十)$/.test(title.replace(/\s+/g, ""));
}

function inferLunarYear(anniversary: Anniversary): number {
  const [year, month] = anniversary.date.split("-").map(Number);
  // Lunar twelfth-month dates often occur in January/February of the next
  // Gregorian year (除夕/腊八 are the common examples).
  return knownLunarHoliday(anniversary.title)?.month === 12 && month <= 2 ? year - 1 : year;
}

const WEEKDAY_HOLIDAYS: Array<{ names: string[]; title: string; month: number; weekday: number; nth: number }> = [
  { names: ["母亲节"], title: "母亲节", month: 5, weekday: 0, nth: 2 },
  { names: ["父亲节"], title: "父亲节", month: 6, weekday: 0, nth: 3 }
];

export function resolveHoliday(text: string, now = new Date()): ResolvedHoliday | null {
  return resolveHolidays(text, now)[0] ?? null;
}

export function resolveHolidays(text: string, now = new Date()): ResolvedHoliday[] {
  const normalized = text.replace(/\s+/g, "");
  const year = extractYear(normalized, now);
  const holidays: ResolvedHoliday[] = [];
  for (const solar of SOLAR_HOLIDAYS) {
    if (solar.names.some((name) => normalized.includes(name))) {
      holidays.push({ title: solar.title, kind: "holiday", date: formatDate(year, solar.month, solar.day), calendarType: "solar" });
    }
  }

  if (/清明节|清明/.test(normalized)) {
    const date = qingmingDateForYear(year);
    if (date) holidays.push({ title: "清明节", kind: "holiday", date, calendarType: "solar" });
  }

  if (/(除夕|大年三十)/.test(normalized)) {
    const spring = gregorianDateForLunarDate(year, 1, 1);
    if (spring) {
      const date = new Date(`${spring}T00:00:00+08:00`);
      date.setDate(date.getDate() - 1);
      const occurrenceDate = toISODateInBeijing(date);
      const lunarParts = lunarDateParts(new Date(`${occurrenceDate}T12:00:00+08:00`));
      holidays.push({ title: "除夕", kind: "holiday", date: occurrenceDate, calendarType: "lunar", lunarYear: lunarParts.relatedYear, lunarMonth: lunarParts.month, lunarDay: lunarParts.day, lunarIsLeapMonth: lunarParts.isLeapMonth });
    }
  }

  for (const lunar of LUNAR_HOLIDAYS) {
    if (!lunar.names.some((name) => normalized.includes(name))) continue;
    const lunarMonth = LUNAR_MONTHS.indexOf(lunar.month as typeof LUNAR_MONTHS[number]) + 1;
    const lunarYear = lunarMonth === 12 ? year - 1 : year;
    const date = gregorianDateForLunarDate(lunarYear, lunarMonth, lunar.day);
    if (date) holidays.push({ title: lunar.title, kind: "holiday", date, calendarType: "lunar", lunarYear, lunarMonth, lunarDay: lunar.day });
  }

  for (const holiday of WEEKDAY_HOLIDAYS) {
    if (!holiday.names.some((name) => normalized.includes(name))) continue;
    holidays.push({
      title: holiday.title,
      kind: "holiday",
      date: nthWeekdayOfMonth(year, holiday.month, holiday.weekday, holiday.nth),
      calendarType: "solar"
    });
  }

  return uniqueHolidays(holidays);
}

function isHolidayText(text: string): boolean {
  return Boolean(resolveHoliday(text));
}

function isExactHolidayTitle(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").replace(/^\d{4}年/, "");
  return [...SOLAR_HOLIDAYS, ...LUNAR_HOLIDAYS, ...WEEKDAY_HOLIDAYS].some((holiday) => holiday.names.includes(normalized))
    || /^(清明节?|除夕|大年三十)$/.test(normalized);
}

function explicitYear(text: string): number | null {
  const value = /(?:^|[^\d])(19\d{2}|20\d{2}|2100)(?:年|[-/.]|$)/.exec(text)?.[1];
  return value ? Number(value) : null;
}

function extractYear(text: string, now: Date): number {
  const explicit = explicitYear(text);
  if (explicit) return explicit;
  if (/明年/.test(text)) return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now)) + 1;
  if (/去年/.test(text)) return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now)) - 1;
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now));
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return formatDate(year, month, 1 + offset + (nth - 1) * 7);
}

function uniqueHolidays(holidays: ResolvedHoliday[]): ResolvedHoliday[] {
  const seen = new Set<string>();
  return holidays.filter((holiday) => {
    const key = `${holiday.title}:${holiday.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Bind a source date to its own record instead of borrowing the first date in
 * a multi-record command. Model fields remain usable if the source is ambiguous. */
function anniversaryDateSource(text: string, title: string): string {
  const normalized = text.replace(/[ \t\r]+/g, "");
  const clauses = normalized.split(/[，,；;\n、]/).filter(Boolean);
  const titleKey = title.replace(/\s+/g, "");
  const person = titleKey.replace(/(?:的)?(?:生日|纪念日|周年纪念|节日)$/, "");
  const matches = clauses.filter((clause) => clause.includes(titleKey) || (person && clause.includes(person)));
  const datePattern = /(?:闰)?(?:十一|十二|正|冬|腊|十|[一二三四五六七八九]|1[0-2]|0?[1-9])月|(?:19\d{2}|20\d{2}|2100)[-/.]\d{1,2}[-/.]\d{1,2}/g;
  const dateCount = [...normalized.matchAll(datePattern)].length;
  const scoped = dateCount <= 1 ? normalized : matches.length === 1 && [...matches[0].matchAll(datePattern)].length === 1 ? matches[0] : "";
  if (!scoped) return "";
  const globalLunar = /(?:全部|所有|统一|全是|全都(?:是|按|用)?|一律|都(?:是|按|用)).{0,5}(?:农历|阴历|旧历)|^(?:农历|阴历|旧历)[：:]/.test(normalized);
  const sourceYears = new Set([...normalized.matchAll(/(?:19\d{2}|20\d{2}|2100)(?=年|[-/.]|$)/g)].map(match => Number(match[0])));
  const year = sourceYears.size === 1 ? [...sourceYears][0] : null;
  return `${year && !explicitYear(scoped) ? `${year}年` : ""}${globalLunar && !/(农历|阴历|旧历|公历|阳历)/.test(scoped) ? "农历" : ""}${scoped}`;
}

function hasExplicitLunarDate(text: string): boolean {
  return /(农历|阴历|旧历)/.test(text) && /月(?:初|十|二十|三十|廿|[一二三四五六七八九]|\d)|(?:19\d{2}|20\d{2}|2100)[-/.]\d{1,2}[-/.]\d{1,2}/.test(text);
}

function resolveLunarDateFromText(text: string, now: Date, fallbackYear?: number): ResolvedHoliday | null {
  const normalized = text.replace(/\s+/g, "");
  if (!/(农历|阴历|旧历)/.test(normalized)) return null;
  const currentYear = lunarDateParts(now).relatedYear;
  const year = explicitYear(normalized) ?? (/明年/.test(normalized) ? currentYear + 1 : /去年/.test(normalized) ? currentYear - 1 : fallbackYear ?? currentYear);
  const numericDate = /(?:19\d{2}|20\d{2}|2100)[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(normalized);
  if (numericDate) {
    const lunarMonth = Number(numericDate[1]);
    const lunarDay = Number(numericDate[2]);
    const lunarIsLeapMonth = /闰/.test(normalized);
    if (isSolarToLunarConversion(normalized, numericDate.index)) {
      const date = formatDate(year, lunarMonth, lunarDay);
      return isISODate(date) ? lunarFieldsFromGregorianDate(date) : null;
    }
    const date = gregorianDateForLunarDate(year, lunarMonth, lunarDay, lunarIsLeapMonth);
    return date ? { title: "农历日子", kind: "anniversary", date, calendarType: "lunar", lunarYear: year, lunarMonth, lunarDay, lunarIsLeapMonth } : null;
  }
  const monthMatch = /(闰)?(十一|十二|正|一|二|三|四|五|六|七|八|九|十|冬|腊|1[0-2]|0?[1-9])月/.exec(normalized);
  if (!monthMatch) return null;
  const monthText = monthMatch[0];
  const monthStart = monthMatch.index ?? 0;
  const dayMatch = /^(初[一二三四五六七八九十]|二十[一二三四五六七八九]?|三十|廿[一二三四五六七八九]?|十[一二三四五六七八九]?|[一二三四五六七八九]|\d{1,2})(?![\d一二三四五六七八九十廿])(?:日|号)?/.exec(normalized.slice(monthStart + monthText.length));
  if (!dayMatch) return null;
  const dayText = dayMatch[1];
  const month = /^\d+$/.test(monthMatch[2]) ? Number(monthMatch[2]) : { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 冬: 11, 腊: 12 }[monthMatch[2]];
  const numericDay = /^\d+$/.test(dayText) ? Number(dayText) : null;
  const parsedDay = numericDay ?? (dayText === "三十" ? 30 : dayText === "二十" ? 20 : dayText.startsWith("廿") ? 20 + chineseNumber(dayText.slice(1)) : dayText.startsWith("十") ? (dayText === "十" ? 10 : 10 + chineseNumber(dayText.slice(1))) : dayText.startsWith("初") ? chineseNumber(dayText.slice(1)) : chineseNumber(dayText));
  const day = parsedDay;
  if (!month || !Number.isInteger(day) || day < 1 || day > 30) return null;
  if (isSolarToLunarConversion(normalized, monthStart)) {
    const date = formatDate(year, month, day);
    return isISODate(date) ? lunarFieldsFromGregorianDate(date) : null;
  }
  const date = gregorianDateForLunarDate(year, month, day, Boolean(monthMatch[1]));
  if (!date) return null;
  return { title: "农历日子", kind: "anniversary", date, calendarType: "lunar", lunarYear: year, lunarMonth: month, lunarDay: day, lunarIsLeapMonth: Boolean(monthMatch[1]) };
}

function isSolarToLunarConversion(text: string, dateIndex?: number): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (!/(?:公历|阳历).*(?:换算|转换|转成|转为|改成|改为).*(?:农历|阴历|旧历)/.test(normalized)) return false;
  if (dateIndex == null) return true;
  const prefix = normalized.slice(0, dateIndex);
  const lastSolar = Math.max(prefix.lastIndexOf("公历"), prefix.lastIndexOf("阳历"));
  const lastLunar = Math.max(prefix.lastIndexOf("农历"), prefix.lastIndexOf("阴历"), prefix.lastIndexOf("旧历"));
  return lastLunar <= lastSolar;
}

function lunarFieldsFromGregorianDate(date: string): ResolvedHoliday {
  const parts = lunarDateParts(new Date(`${date}T12:00:00+08:00`));
  return { title: "农历日子", kind: "anniversary", date, calendarType: "lunar", lunarYear: parts.relatedYear,
    lunarMonth: parts.month, lunarDay: parts.day, lunarIsLeapMonth: parts.isLeapMonth };
}

function chineseNumber(value: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.length === 1) return map[value] ?? 0;
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (map[value.slice(1)] ?? 0);
  if (value.startsWith("二十")) return 20 + (map[value.slice(2)] ?? 0);
  return 0;
}

function toISODateInBeijing(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
