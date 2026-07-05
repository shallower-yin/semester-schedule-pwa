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
import { getDeviceId, syncFields } from "./lib/identity";

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
    this.version(2)
      .stores({
        semesters: "id, is_current, start_date, updated_at, deleted_at",
        classPeriods: "id, semester_id, [semester_id+weekday], [semester_id+weekday+period_number], updated_at, deleted_at",
        courses: "id, semester_id, name, updated_at, deleted_at",
        courseSchedules: "id, course_id, weekday, updated_at, deleted_at",
        courseCancellations: "id, course_schedule_id, occurrence_date, updated_at, deleted_at",
        categories: "id, name, updated_at, deleted_at",
        events: "id, start_date, end_date, recurrence_type, updated_at, deleted_at",
        eventOccurrenceStates: "id, [event_id+occurrence_date], updated_at, deleted_at",
        syncQueue: "id, table_name, record_id, queued_at"
      })
      .upgrade(async (transaction) => {
        const now = new Date().toISOString();
        const periodTable = transaction.table("classPeriods");
        const semesterTable = transaction.table("semesters");
        const eventTable = transaction.table("events");
        const occurrenceStateTable = transaction.table("eventOccurrenceStates");
        const queueTable = transaction.table("syncQueue");
        const periods = await periodTable.toArray();
        for (const period of periods) {
          if (period.kind && period.sort_order) continue;
          const updated = {
            ...period,
            kind: "period",
            sort_order: period.period_number <= 4 ? period.period_number : period.period_number + 1,
            updated_at: now,
            version: Number(period.version ?? 0) + 1
          };
          await periodTable.put(updated);
          await queueTable.put({
            id: crypto.randomUUID(),
            table_name: "classPeriods",
            record_id: period.id,
            operation: "upsert",
            queued_at: now,
            attempts: 0,
            last_error: null
          });
        }
        const semesters = await semesterTable.toArray();
        for (const semester of semesters) {
          for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
            const exists = periods.some(
              (period) => period.semester_id === semester.id && period.weekday === weekday && period.kind === "break"
            );
            if (exists) continue;
            const id = crypto.randomUUID();
            await periodTable.add({
              id,
              user_id: semester.user_id,
              created_at: now,
              updated_at: now,
              deleted_at: null,
              version: 1,
              device_id: semester.device_id ?? getDeviceId(),
              semester_id: semester.id,
              weekday,
              period_number: 0,
              kind: "break",
              sort_order: 5,
              name: "午休",
              start_time: "12:00",
              end_time: "13:30"
            });
            await queueTable.add({
              id: crypto.randomUUID(),
              table_name: "classPeriods",
              record_id: id,
              operation: "upsert",
              queued_at: now,
              attempts: 0,
              last_error: null
            });
          }
        }
        const events = await eventTable.toArray();
        for (const event of events) {
          if (typeof event.reminder_enabled === "boolean") continue;
          await eventTable.put({
            ...event,
            reminder_enabled: false,
            reminder_minutes_before: 10,
            timezone: "Asia/Shanghai",
            updated_at: now,
            version: Number(event.version ?? 0) + 1
          });
          await queueTable.put({
            id: crypto.randomUUID(),
            table_name: "events",
            record_id: event.id,
            operation: "upsert",
            queued_at: now,
            attempts: 0,
            last_error: null
          });
        }
        const occurrenceStates = await occurrenceStateTable.toArray();
        for (const state of occurrenceStates) {
          if ("reminder_sent_at" in state) continue;
          await occurrenceStateTable.put({
            ...state,
            reminder_sent_at: null,
            updated_at: now,
            version: Number(state.version ?? 0) + 1
          });
          await queueTable.put({
            id: crypto.randomUUID(),
            table_name: "eventOccurrenceStates",
            record_id: state.id,
            operation: "upsert",
            queued_at: now,
            attempts: 0,
            last_error: null
          });
        }
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
