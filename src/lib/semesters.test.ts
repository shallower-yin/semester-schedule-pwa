import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { ClassPeriod, Course, CourseCancellation, CourseSchedule, EventItem, Semester, SyncFields } from "../types";
import { setCurrentUserId } from "./identity";
import { deleteSemesterCascade, saveSemesterRecord } from "./semesters";

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

describe("学期删除", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId(userId);
    await db.semesters.clear();
    await db.classPeriods.clear();
    await db.courses.clear();
    await db.courseSchedules.clear();
    await db.courseCancellations.clear();
    await db.events.clear();
    await db.syncQueue.clear();
  });

  it("硬删除学期以及课程相关数据，但不影响普通事项", async () => {
    const semester: Semester = {
      ...fields("semester-1"),
      name: "2026 春",
      start_date: "2026-03-02",
      total_weeks: 20,
      is_current: true
    };
    const period: ClassPeriod = {
      ...fields("period-1"),
      semester_id: semester.id,
      weekday: 1,
      period_number: 1,
      kind: "period",
      sort_order: 1,
      name: "第 1 节",
      start_time: "08:30",
      end_time: "09:15"
    };
    const course: Course = {
      ...fields("course-1"),
      semester_id: semester.id,
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
      end_period: 1,
      weeks: [1]
    };
    const cancellation: CourseCancellation = {
      ...fields("cancel-1"),
      course_schedule_id: schedule.id,
      occurrence_date: "2026-03-02",
      reason: "停课"
    };
    const eventItem: EventItem = {
      ...fields("event-1"),
      event_type: "event",
      title: "普通事项",
      start_date: "2026-03-02",
      start_time: "09:00",
      end_date: "2026-03-02",
      end_time: "09:00",
      all_day: false,
      category_id: null,
      color: "#e36b32",
      note: "",
      recurrence_type: "none",
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: false,
      reminder_minutes_before: 10,
      timezone: "Asia/Shanghai"
    };
    await db.semesters.put(semester);
    await db.classPeriods.put(period);
    await db.courses.put(course);
    await db.courseSchedules.put(schedule);
    await db.courseCancellations.put(cancellation);
    await db.events.put(eventItem);

    expect(await deleteSemesterCascade(semester.id)).toEqual({
      semesters: 1,
      classPeriods: 1,
      courses: 1,
      courseSchedules: 1,
      courseCancellations: 1
    });

    expect(await db.semesters.get(semester.id)).toBeUndefined();
    expect(await db.classPeriods.get(period.id)).toBeUndefined();
    expect(await db.courses.get(course.id)).toBeUndefined();
    expect(await db.courseSchedules.get(schedule.id)).toBeUndefined();
    expect(await db.courseCancellations.get(cancellation.id)).toBeUndefined();
    expect((await db.events.get(eventItem.id))?.deleted_at).toBeNull();
    expect((await db.syncQueue.toArray()).map((item) => item.operation)).toEqual(["delete", "delete", "delete", "delete", "delete"]);
  });

  it("新建学期复用统一逻辑并建立七天默认时间块", async () => {
    const previous: Semester = { ...fields("semester-old"), name: "旧学期", start_date: "2026-02-23", total_weeks: 18, is_current: true };
    await db.semesters.put(previous);

    const created = await saveSemesterRecord({ name: "2026 秋", startDate: "2026-09-07", totalWeeks: 20 });

    expect(created.name).toBe("2026 秋");
    expect(created.is_current).toBe(true);
    expect((await db.semesters.get(previous.id))?.is_current).toBe(false);
    const periods = await db.classPeriods.where("semester_id").equals(created.id).toArray();
    expect(new Set(periods.map((period) => period.weekday))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    expect(periods.length).toBeGreaterThan(70);
  });
});
