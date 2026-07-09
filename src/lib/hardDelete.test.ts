import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { Course, CourseCancellation, CourseSchedule, EventItem, EventOccurrenceState, SyncFields } from "../types";
import { setCurrentUserId } from "./identity";
import { hardDeleteCoursesCascade, hardDeleteEventsCascade } from "./hardDelete";

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
    await db.courses.clear();
    await db.courseSchedules.clear();
    await db.courseCancellations.clear();
    await db.syncQueue.clear();
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
    await db.events.put(eventItem);
    await db.eventOccurrenceStates.put(state);

    await hardDeleteEventsCascade([eventItem.id]);

    expect(await db.events.get(eventItem.id)).toBeUndefined();
    expect(await db.eventOccurrenceStates.get(state.id)).toBeUndefined();
    expect((await db.syncQueue.toArray()).map((item) => `${item.table_name}:${item.operation}`).sort()).toEqual([
      "eventOccurrenceStates:delete",
      "events:delete"
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
