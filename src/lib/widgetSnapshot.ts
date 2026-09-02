import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  FocusSession,
  Semester,
  TodoItem
} from "../types";
import { addDays, dateAtProductTime, PRODUCT_TIME_ZONE, toISODate } from "./date";
import { buildScheduleOverview, type ScheduleOverviewItem } from "./overview";

export const WIDGET_SNAPSHOT_SCHEMA = 1 as const;
export const WIDGET_SNAPSHOT_DAYS = 7;
export const WIDGET_MAX_ITEMS_PER_DAY = 8;
export const WIDGET_MAX_TODOS = 3;

export interface WidgetSnapshotItem {
  /** Deep-link key understood by the existing native notification router. */
  key: string;
  kind: "event" | "course";
  targetId: string;
  title: string;
  startMinute: number | null;
  endMinute: number | null;
  allDay: boolean;
  completed: boolean;
  color: string;
}

export interface WidgetSnapshotDay {
  date: string;
  items: WidgetSnapshotItem[];
}

/** The native widget only needs a label because every row opens the todo page. */
export interface WidgetSnapshotTodo {
  title: string;
}

export interface WidgetSnapshot {
  schema: typeof WIDGET_SNAPSHOT_SCHEMA;
  generatedAt: string;
  validUntil: string;
  timezone: typeof PRODUCT_TIME_ZONE;
  days: WidgetSnapshotDay[];
  /** Optional so schema-1 snapshots remain readable by old and new APKs. */
  todos?: WidgetSnapshotTodo[];
}

export interface WidgetSnapshotInput {
  ownerId: string;
  semester?: Semester | null;
  courses: Course[];
  schedules: CourseSchedule[];
  cancellations: CourseCancellation[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
  focusSessions: FocusSession[];
  todos?: TodoItem[];
}

export interface BuildWidgetSnapshotOptions {
  days?: number;
  maxItemsPerDay?: number;
}

/**
 * Build the small, non-sensitive projection consumed by Android RemoteViews.
 *
 * We intentionally call the existing overview builder for each calendar date
 * instead of reimplementing recurrence, cancellation, semester-week, or
 * completion rules in the native layer.  The native side never reads or writes
 * the Dexie database.
 */
export function buildWidgetSnapshot(
  input: WidgetSnapshotInput,
  now = new Date(),
  options: BuildWidgetSnapshotOptions = {}
): WidgetSnapshot {
  const ownerId = input.ownerId.trim();
  const dayCount = clampInteger(options.days ?? WIDGET_SNAPSHOT_DAYS, 1, 7);
  const maxItemsPerDay = clampInteger(options.maxItemsPerDay ?? WIDGET_MAX_ITEMS_PER_DAY, 1, 12);
  const owned = <T extends { user_id: string }>(items: T[]): T[] => items.filter((item) => item.user_id === ownerId);
  const semester = input.semester?.user_id === ownerId ? input.semester : null;
  const courses = owned(input.courses);
  const schedules = owned(input.schedules);
  const cancellations = owned(input.cancellations);
  const events = owned(input.events);
  const categories = owned(input.categories);
  const occurrenceStates = owned(input.occurrenceStates);
  const periods = owned(input.periods);
  const focusSessions = owned(input.focusSessions);
  const todos = input.todos === undefined
    ? undefined
    : owned(input.todos)
      .filter((todo) => todo.deleted_at === null && todo.completed_at === null)
      .sort(compareTodos)
      .slice(0, WIDGET_MAX_TODOS)
      .map((todo) => ({ title: truncate(todo.title, 80, "未命名待办") }));
  const todayDate = toISODate(now);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = toISODate(addDays(now, index));
    // Noon avoids a date boundary while retaining the requested Asia/Shanghai
    // calendar cell for recurrence and semester-week calculations.
    const dateNow = dateAtProductTime(date, "12:00");
    const overview = buildScheduleOverview({
      semester,
      courses,
      schedules,
      cancellations,
      events,
      categories,
      occurrenceStates,
      periods,
      focusSessions,
      maxItems: maxItemsPerDay
    }, dateNow);
    return {
      date,
      items: overview.upcomingItems.slice(0, maxItemsPerDay).map((item) => toWidgetItem(item, date))
    };
  });

  // Keep the cached days useful across midnight.  The native provider still
  // refuses a snapshot after this final boundary, at which point it asks the
  // user to open the app and refresh the local projection.
  const lastDate = days.at(-1)?.date ?? todayDate;
  const validUntil = dateAtProductTime(toISODate(addDays(dateAtProductTime(lastDate, "12:00"), 1)), "00:00").toISOString();
  const snapshot: WidgetSnapshot = {
    schema: WIDGET_SNAPSHOT_SCHEMA,
    generatedAt: now.toISOString(),
    validUntil,
    timezone: PRODUCT_TIME_ZONE,
    days
  };
  if (todos !== undefined) snapshot.todos = todos;
  return snapshot;
}

function compareTodos(left: TodoItem, right: TodoItem): number {
  if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
  const leftOrder = Number.isFinite(left.sort_order) ? left.sort_order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.sort_order) ? right.sort_order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const created = left.created_at.localeCompare(right.created_at);
  return created !== 0 ? created : left.id.localeCompare(right.id);
}

function toWidgetItem(item: ScheduleOverviewItem, occurrenceDate: string): WidgetSnapshotItem {
  const eventKey = item.type === "event"
    ? `event:${item.targetId}:${item.occurrenceDate ?? occurrenceDate}`
    : "route:today";
  return {
    key: eventKey,
    kind: item.type,
    targetId: item.targetId,
    title: truncate(item.title, 80),
    startMinute: item.allDay ? null : parseMinute(item.type === "course" ? item.sortTime : item.timeLabel),
    endMinute: item.allDay || !item.endTime ? null : parseMinute(item.endTime, true),
    allDay: Boolean(item.allDay),
    completed: Boolean(item.completed),
    color: normalizeColor(item.color)
  };
}

function parseMinute(value: string | null | undefined, last = false): number | null {
  if (!value) return null;
  const matches = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g);
  if (!matches?.length) return null;
  const text = last ? matches.at(-1)! : matches[0];
  const parts = text.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function normalizeColor(value: string | null | undefined): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#3157d5";
}

function truncate(value: string, maxLength: number, fallback = "未命名事项"): string {
  const text = String(value ?? "").trim();
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : text || fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, numeric));
}
