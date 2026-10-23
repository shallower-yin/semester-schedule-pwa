import { beforeEach, describe, expect, it } from "vitest";
import { db, queueChange } from "../db";
import type { Course, CourseCancellation, CourseSchedule, EventItem, EventOccurrenceState, FocusSession, SyncFields } from "../types";
import { setCurrentUserId } from "./identity";
import { hardDeleteCoursesCascade, hardDeleteEventsCascade, hardDeleteLocalRecord, hardDeleteLocalRecords } from "./hardDelete";

const userId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-01-01T00:00:00.000Z";

function fields(id: string): SyncFields {
  return {
    id,
    user_id: userId,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111"
  };
}

describe("硬删除辅助函数", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId(userId);
    await db.events.clear();
    await db.eventOccurrenceStates.clear();
    await db.focusSessions.clear();
    await db.courses.clear();
    await db.courseSchedules.clear();
    await db.courseCancellations.clear();
    await db.syncQueue.clear();
  });

  it.each([false, true])("删除记录失败时回滚删除队列，保留原有待传编辑（批量=%s）", async (batch) => {
    const rows = [fields("delete-first"), fields("delete-second")];
    await db.table("events").bulkPut(rows);
    for (const row of rows) await queueChange("events", row.id, "upsert", userId);
    const originalQueue = await db.syncQueue.toArray();
    const failDelete = (key: string) => {
      if (key === "delete-second") throw new Error("injected delete failure");
    };
    db.events.hook("deleting", failDelete);
    try {
      const deleting = batch
        ? hardDeleteLocalRecords("events", rows.map((row) => row.id))
        : hardDeleteLocalRecord("events", "delete-second");
      await expect(deleting).rejects.toThrow("injected delete failure");
      expect(await db.events.toArray()).toEqual(rows);
      expect(await db.syncQueue.toArray()).toEqual(originalQueue);
    } finally {
      db.events.hook("deleting").unsubscribe(failDelete);
    }
  });

  it("批量删除入队途中失败不会留下部分删除或丢失原同步队列", async () => {
    const rows = [fields("queue-first"), fields("queue-second")];
    await db.table("events").bulkPut(rows);
    for (const row of rows) await queueChange("events", row.id, "upsert", userId);
    const originalQueue = await db.syncQueue.toArray();
    const failQueue = (_key: unknown, row: { record_id: string; operation: string }) => {
      if (row.record_id === "queue-second" && row.operation === "delete") throw new Error("injected queue failure");
    };
    db.syncQueue.hook("creating", failQueue);
    try {
      await expect(hardDeleteLocalRecords("events", rows.map((row) => row.id))).rejects.toThrow("injected queue failure");
      expect(await db.events.toArray()).toEqual(rows);
      expect(await db.syncQueue.toArray()).toEqual(originalQueue);
    } finally {
      db.syncQueue.hook("creating").unsubscribe(failQueue);
    }
  });

  it("硬删除事项时同步删除完成状态", async () => {
    const eventItem: EventItem = {
      ...fields("event-1"),
      event_type: "event",
      title: "交作业",
      start_date: "2026-07-09",
      start_time: "09:00",
      end_date: "2026-07-09",
      end_time: "09:00",
      all_day: false,
      category_id: null,
      color: "#3157d5",
      note: "",
      recurrence_type: "none",
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: false,
      reminder_minutes_before: 10,
      timezone: "Asia/Shanghai"
    };
    const state: EventOccurrenceState = {
      ...fields("state-1"),
      event_id: eventItem.id,
      occurrence_date: "2026-07-09",
      completed: true,
      reminder_sent_at: null
    };
    const focusSession: FocusSession = {
      ...fields("focus-1"),
      mode: "pomodoro",
      task_title: "交作业",
      linked_event_id: eventItem.id,
      planned_seconds: 1500,
      duration_seconds: 1500,
      started_at: "2026-07-09T08:00:00.000Z",
      ended_at: "2026-07-09T08:25:00.000Z",
      completed: true,
      interrupted: false
    };
    await db.events.put(eventItem);
    await db.eventOccurrenceStates.put(state);
    await db.focusSessions.put(focusSession);

    await hardDeleteEventsCascade([eventItem.id]);

    expect(await db.events.get(eventItem.id)).toBeUndefined();
    expect(await db.eventOccurrenceStates.get(state.id)).toBeUndefined();
    expect((await db.focusSessions.get(focusSession.id))?.linked_event_id).toBeNull();
    expect((await db.syncQueue.toArray()).map((item) => `${item.table_name}:${item.operation}`).sort()).toEqual([
      "eventOccurrenceStates:delete",
      "events:delete",
      "focusSessions:upsert"
    ]);
  });

  it("硬删除课程时同步删除课程安排和停课标记", async () => {
    const course: Course = {
      ...fields("course-1"),
      semester_id: "semester-1",
      name: "高数",
      teacher: "",
      classroom: "",
      color: "#3157d5",
      note: ""
    };
    const schedule: CourseSchedule = {
      ...fields("schedule-1"),
      course_id: course.id,
      weekday: 1,
      start_period: 1,
      end_period: 2,
      weeks: [1, 2]
    };
    const cancellation: CourseCancellation = {
      ...fields("cancel-1"),
      course_schedule_id: schedule.id,
      occurrence_date: "2026-07-09",
      reason: "停课"
    };
    await db.courses.put(course);
    await db.courseSchedules.put(schedule);
    await db.courseCancellations.put(cancellation);

    await hardDeleteCoursesCascade([course.id]);

    expect(await db.courses.get(course.id)).toBeUndefined();
    expect(await db.courseSchedules.get(schedule.id)).toBeUndefined();
    expect(await db.courseCancellations.get(cancellation.id)).toBeUndefined();
    expect((await db.syncQueue.toArray()).map((item) => `${item.table_name}:${item.operation}`).sort()).toEqual([
      "courseCancellations:delete",
      "courseSchedules:delete",
      "courses:delete"
    ]);
  });
});
