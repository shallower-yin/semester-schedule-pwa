import Dexie, { type EntityTable } from "dexie";
import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  Semester,
  SyncQueueItem,
  SyncTableName
} from "./types";
import { DEFAULT_CATEGORIES } from "./data/defaults";
import { syncFields } from "./lib/identity";

class ScheduleDatabase extends Dexie {
  semesters!: EntityTable<Semester, "id">;
  classPeriods!: EntityTable<ClassPeriod, "id">;
  courses!: EntityTable<Course, "id">;
  courseSchedules!: EntityTable<CourseSchedule, "id">;
  courseCancellations!: EntityTable<CourseCancellation, "id">;
  categories!: EntityTable<Category, "id">;
  events!: EntityTable<EventItem, "id">;
  eventOccurrenceStates!: EntityTable<EventOccurrenceState, "id">;
  syncQueue!: EntityTable<SyncQueueItem, "id">;

  constructor() {
    super("semester-schedule");
    this.version(1).stores({
      semesters: "id, is_current, start_date, updated_at, deleted_at",
      classPeriods: "id, semester_id, [semester_id+weekday], [semester_id+weekday+period_number], updated_at, deleted_at",
      courses: "id, semester_id, name, updated_at, deleted_at",
      courseSchedules: "id, course_id, weekday, updated_at, deleted_at",
      courseCancellations: "id, course_schedule_id, occurrence_date, updated_at, deleted_at",
      categories: "id, name, updated_at, deleted_at",
      events: "id, start_date, end_date, recurrence_type, updated_at, deleted_at",
      eventOccurrenceStates: "id, [event_id+occurrence_date], updated_at, deleted_at",
      syncQueue: "id, table_name, record_id, queued_at"
    });
  }
}

export const db = new ScheduleDatabase();

export async function initializeDatabase(): Promise<void> {
  if ((await db.categories.count()) === 0) {
    await db.categories.bulkAdd(
      DEFAULT_CATEGORIES.map((category) => ({
        ...syncFields(),
        ...category
      }))
    );
  }
}

export async function queueChange(table_name: SyncTableName, record_id: string, operation: "upsert" | "delete" = "upsert") {
  const existing = await db.syncQueue.where({ table_name, record_id }).first();
  await db.syncQueue.put({
    id: existing?.id ?? crypto.randomUUID(),
    table_name,
    record_id,
    operation,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  });
}
