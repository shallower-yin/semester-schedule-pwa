import type { SyncTableName } from "../types";
import { lunarOccurrenceDates } from "./lunarCalendar";
import { normalizeMemoImages } from "./memoImages";

// Keep download defaults separate from upload validation: the two directions
// intentionally differ, and uploads must not include server-managed fields.
export function normalizeRemoteRecord(table: SyncTableName, record: Record<string, unknown>) {
  if (table === "classPeriods") {
    return {
      ...record,
      kind: record.kind ?? "period",
      sort_order: Number(record.sort_order ?? record.period_number ?? 0),
      start_time: String(record.start_time).slice(0, 5),
      end_time: String(record.end_time).slice(0, 5)
    };
  }
  if (table === "events") {
    return {
      ...record,
      event_type: record.event_type ?? "event",
      start_time: record.start_time ? String(record.start_time).slice(0, 5) : null,
      end_time: record.end_time ? String(record.end_time).slice(0, 5) : null,
      location: String(record.location ?? ""),
      reminder_enabled: Boolean(record.reminder_enabled),
      reminder_minutes_before: Number(record.reminder_minutes_before ?? 10),
      recurrence_interval: Number(record.recurrence_interval ?? 1),
      timezone: "Asia/Shanghai"
    };
  }
  if (table === "eventOccurrenceStates") {
    return { ...record, reminder_sent_at: record.reminder_sent_at ?? null };
  }
  if (table === "anniversaries") {
    return {
      ...record,
      kind: record.kind ?? "anniversary",
      calendar_type: record.calendar_type === "lunar" ? "lunar" : "solar",
      lunar_year: record.lunar_year == null ? null : Number(record.lunar_year),
      lunar_month: record.lunar_month == null ? null : Number(record.lunar_month),
      lunar_day: record.lunar_day == null ? null : Number(record.lunar_day),
      lunar_is_leap_month: Boolean(record.lunar_is_leap_month),
      lunar_occurrence_dates: Array.isArray(record.lunar_occurrence_dates)
        ? record.lunar_occurrence_dates.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
        : [],
      color: String(record.color ?? "#d97706"),
      note: String(record.note ?? ""),
      reminder_enabled: Boolean(record.reminder_enabled),
      reminder_days_before: Number(record.reminder_days_before ?? 0),
      reminder_time: String(record.reminder_time ?? "09:00").slice(0, 5),
      reminder_sent_for: record.reminder_sent_for ?? null,
      timezone: "Asia/Shanghai"
    };
  }
  if (table === "memos") {
    return {
      ...record,
      folder_id: record.folder_id ?? null,
      is_pinned: Boolean(record.is_pinned),
      images: normalizeMemoImages(record.images)
    };
  }
  if (table === "todos") {
    return {
      ...record,
      title: String(record.title ?? ""),
      color: normalizeTodoColor(record.color),
      sort_order: Number(record.sort_order ?? 0),
      is_pinned: Boolean(record.is_pinned),
      completed_at: record.completed_at ?? null,
      reminder_enabled: Boolean(record.reminder_enabled),
      reminder_at: normalizeNullableDateTime(record.reminder_at),
      reminder_sent_at: normalizeNullableDateTime(record.reminder_sent_at)
    };
  }
  if (table === "healthProfiles") {
    return {
      ...record,
      height_cm: record.height_cm == null ? null : Number(record.height_cm),
      daily_water_goal_ml: Number(record.daily_water_goal_ml ?? 2000),
      exercise_items: normalizeExerciseItems(record.exercise_items),
      movement_reminder_enabled: Boolean(record.movement_reminder_enabled),
      movement_interval_minutes: Number(record.movement_interval_minutes ?? 60),
      reminder_start_time: String(record.reminder_start_time ?? "09:00").slice(0, 5),
      reminder_end_time: String(record.reminder_end_time ?? "22:00").slice(0, 5),
      last_movement_reminder_at: record.last_movement_reminder_at ?? null
    };
  }
  if (table === "healthLogs") {
    return {
      ...record,
      amount: Number(record.amount ?? 0),
      activity: record.activity == null ? null : String(record.activity),
      note: String(record.note ?? "")
    };
  }
  if (table === "focusSettings") {
    return {
      ...record,
      pomodoro_minutes: Number(record.pomodoro_minutes ?? 25),
      pomodoro_rounds: Number(record.pomodoro_rounds ?? 4),
      short_break_minutes: Number(record.short_break_minutes ?? 5),
      long_break_minutes: Number(record.long_break_minutes ?? 15),
      long_break_interval: Number(record.long_break_interval ?? 4),
      auto_start_break: record.auto_start_break !== false,
      countdown_minutes: Number(record.countdown_minutes ?? 30),
      daily_goal_minutes: Number(record.daily_goal_minutes ?? 120),
      sound_enabled: Boolean(record.sound_enabled)
    };
  }
  if (table === "focusSessions") {
    return {
      ...record,
      linked_event_id: record.linked_event_id ?? null,
      planned_seconds: record.planned_seconds == null ? null : Number(record.planned_seconds),
      duration_seconds: Number(record.duration_seconds ?? 0),
      completed: Boolean(record.completed),
      interrupted: Boolean(record.interrupted),
      pomodoro_plan_id: record.pomodoro_plan_id ?? null,
      pomodoro_round: record.pomodoro_round == null ? null : Number(record.pomodoro_round)
    };
  }
  if (table === "restSessions") {
    return {
      ...record,
      planned_seconds: Number(record.planned_seconds ?? 0),
      duration_seconds: Number(record.duration_seconds ?? 0),
      completed: Boolean(record.completed),
      interrupted: Boolean(record.interrupted),
      rest_kind: record.rest_kind == null ? "manual" : String(record.rest_kind),
      pomodoro_plan_id: record.pomodoro_plan_id ?? null,
      pomodoro_round: record.pomodoro_round == null ? null : Number(record.pomodoro_round)
    };
  }
  return record;
}

export function normalizeUploadPayload(table: SyncTableName, record: Record<string, unknown>): Record<string, unknown> {
  const { server_updated_at: _serverUpdatedAt, ...payload } = record;
  if (table === "events" || table === "anniversaries") {
    if (table === "anniversaries" && payload.calendar_type === "lunar"
      && Number.isInteger(payload.lunar_year)
      && Number.isInteger(payload.lunar_month)
      && Number.isInteger(payload.lunar_day)) {
      const dates = Array.isArray(payload.lunar_occurrence_dates) ? payload.lunar_occurrence_dates : [];
      return {
        ...payload,
        timezone: "Asia/Shanghai",
        lunar_occurrence_dates: dates.length ? dates : lunarOccurrenceDates(
          Number(payload.lunar_year),
          Number(payload.lunar_month),
          Number(payload.lunar_day),
          Boolean(payload.lunar_is_leap_month)
        )
      };
    }
    return { ...payload, timezone: "Asia/Shanghai" };
  }
  if (table === "healthProfiles") {
    return {
      ...payload,
      height_cm: payload.height_cm == null ? null : Number(payload.height_cm),
      daily_water_goal_ml: Number(payload.daily_water_goal_ml ?? 2000),
      exercise_items: normalizeExerciseItems(payload.exercise_items),
      movement_reminder_enabled: Boolean(payload.movement_reminder_enabled),
      movement_interval_minutes: Number(payload.movement_interval_minutes ?? 60),
      reminder_start_time: String(payload.reminder_start_time ?? "09:00").slice(0, 5),
      reminder_end_time: String(payload.reminder_end_time ?? "22:00").slice(0, 5),
      last_movement_reminder_at: payload.last_movement_reminder_at ?? null
    };
  }
  if (table === "todos") {
    return {
      ...payload,
      title: String(payload.title ?? "").trim(),
      color: normalizeTodoColor(payload.color),
      sort_order: Number(payload.sort_order ?? 0),
      is_pinned: Boolean(payload.is_pinned),
      completed_at: payload.completed_at ?? null,
      reminder_enabled: Boolean(payload.reminder_enabled),
      reminder_at: normalizeNullableDateTime(payload.reminder_at),
      reminder_sent_at: normalizeNullableDateTime(payload.reminder_sent_at)
    };
  }
  if (table === "focusSessions") {
    const mode = payload.mode;
    const safeMode = mode === "stopwatch" || mode === "countdown" || mode === "pomodoro" || mode === "lock"
      ? mode
      : "pomodoro";
    return {
      ...payload,
      mode: safeMode,
      task_title: String(payload.task_title ?? ""),
      linked_event_id: payload.linked_event_id ?? null,
      planned_seconds: payload.planned_seconds == null ? null : Number(payload.planned_seconds),
      duration_seconds: Number(payload.duration_seconds ?? 0),
      completed: Boolean(payload.completed),
      interrupted: Boolean(payload.interrupted),
      pomodoro_plan_id: payload.pomodoro_plan_id ?? null,
      pomodoro_round: payload.pomodoro_round == null ? null : Number(payload.pomodoro_round)
    };
  }
  if (table !== "restSessions") return payload;
  const restKind = payload.rest_kind;
  return {
    ...payload,
    planned_seconds: Number(payload.planned_seconds ?? 0),
    duration_seconds: Number(payload.duration_seconds ?? 0),
    completed: Boolean(payload.completed),
    interrupted: Boolean(payload.interrupted),
    rest_kind: restKind === "pomodoro_short" || restKind === "pomodoro_long" ? restKind : "manual",
    pomodoro_plan_id: payload.pomodoro_plan_id ?? null,
    pomodoro_round: payload.pomodoro_round == null ? null : Number(payload.pomodoro_round)
  };
}

function normalizeExerciseItems(value: unknown): string[] {
  if (!Array.isArray(value)) return ["俯卧撑", "仰卧起坐", "深蹲"];
  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 12);
  return items.length ? [...new Set(items)] : ["俯卧撑", "仰卧起坐", "深蹲"];
}

function normalizeTodoColor(value: unknown): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#cfeeff";
}

function normalizeNullableDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
