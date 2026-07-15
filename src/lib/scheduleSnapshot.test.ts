import { describe, expect, it } from "vitest";
import type { ClassPeriod, Course, CourseSchedule, EventItem, Semester, SyncFields } from "../types";
import { buildSnapshotDays } from "./scheduleSnapshot";

const fields: SyncFields = {
  id: "base",
  user_id: "user-1",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "device-1"
};

describe("日程快照数据", () => {
  it("按指定日期合并课程、事项和完成状态", () => {
    const semester: Semester = { ...fields, id: "semester-1", name: "测试学期", start_date: "2026-07-13", total_weeks: 20, is_current: true };
    const course: Course = { ...fields, id: "course-1", semester_id: semester.id, name: "高等数学", teacher: "张老师", classroom: "A101", color: "#3157d5", note: "" };
    const schedule: CourseSchedule = { ...fields, id: "schedule-1", course_id: course.id, weekday: 3, start_period: 1, end_period: 2, weeks: [1] };
    const periods: ClassPeriod[] = [
      { ...fields, id: "period-1", semester_id: semester.id, weekday: 3, period_number: 1, kind: "period", sort_order: 1, name: "第一节", start_time: "08:30", end_time: "09:15" },
      { ...fields, id: "period-2", semester_id: semester.id, weekday: 3, period_number: 2, kind: "period", sort_order: 2, name: "第二节", start_time: "09:20", end_time: "10:05" }
    ];
    const event: EventItem = {
      ...fields, id: "event-1", event_type: "event", title: "交作业", start_date: "2026-07-15", start_time: "14:00", end_date: "2026-07-15", end_time: "14:30", all_day: false,
      category_id: null, color: "#ff6b35", note: "", location: "线上", recurrence_type: "none", recurrence_until: null, recurrence_interval: 1,
      reminder_enabled: false, reminder_minutes_before: 10, timezone: "Asia/Shanghai"
    };
    const [day] = buildSnapshotDays({ semester, courses: [course], schedules: [schedule], cancellations: [], events: [event], categories: [], occurrenceStates: [{ ...fields, id: "state-1", event_id: event.id, occurrence_date: "2026-07-15", completed: true, reminder_sent_at: null }], periods }, [new Date(2026, 6, 15)]);

    expect(day.items.map((item) => item.title)).toEqual(["高等数学", "交作业"]);
    expect(day.items[0].time).toBe("08:30-10:05");
    expect(day.items[1]).toMatchObject({ completed: true, detail: "线上" });
  });
});
