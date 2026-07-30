import { describe, expect, it } from "vitest";
import type { ClassPeriod, Course, CourseSchedule, Semester } from "../types";
import { buildIcsCalendar } from "./ics";

const fields = {
  id: "base",
  user_id: "local",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "device"
};

describe("课程 ICS 教学周日期", () => {
  it("非周一开学时第二周课程从下一个周一开始", () => {
    const semester: Semester = { ...fields, id: "semester", name: "测试", start_date: "2026-09-02", total_weeks: 18, is_current: true };
    const course: Course = { ...fields, id: "course", semester_id: semester.id, name: "高数", teacher: "", classroom: "", note: "", color: "#3157d5" };
    const schedule: CourseSchedule = { ...fields, id: "schedule", course_id: course.id, weekday: 1, start_period: 1, end_period: 1, weeks: [1, 2] };
    const period: ClassPeriod = {
      ...fields,
      id: "period",
      semester_id: semester.id,
      weekday: 1,
      period_number: 1,
      kind: "period",
      sort_order: 1,
      name: "第一节",
      start_time: "08:00",
      end_time: "08:45"
    };

    const ics = buildIcsCalendar({ semester, courses: [course], schedules: [schedule], periods: [period], events: [] });

    expect(ics).not.toContain("DTSTART:20260831T080000");
    expect(ics).toContain("DTSTART:20260907T080000");
  });
});
