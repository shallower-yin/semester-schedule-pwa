import { describe, expect, it } from "vitest";
import type { ClassPeriod, Course, CourseSchedule, EventItem, Semester } from "../types";
import { findCourseEventConflicts, findEventConflicts, findEventCourseConflicts, timeRangesOverlap } from "./conflicts";

const syncFields = {
  id: "draft",
  user_id: "local",
  created_at: "2026-11-06T00:00:00+08:00",
  updated_at: "2026-11-06T00:00:00+08:00",
  deleted_at: null,
  version: 1,
  device_id: "test"
};

const timedEvent: EventItem = {
  ...syncFields,
  event_type: "event",
  title: "学习",
  start_date: "2026-11-06",
  end_date: "2026-11-06",
  start_time: "09:00",
  end_time: "10:00",
  all_day: false,
  category_id: null,
  color: "#e36b32",
  note: "",
  recurrence_type: "none",
  recurrence_until: null,
  recurrence_interval: 1,
  reminder_enabled: false,
  reminder_minutes_before: 0,
  timezone: "Asia/Shanghai"
};

const allDayEvent: EventItem = { ...timedEvent, id: "all-day", all_day: true, start_time: null, end_time: null };
const existingEvent: EventItem = { ...timedEvent, id: "existing" };
const semester: Semester = { ...syncFields, id: "semester", name: "秋季学期", start_date: "2026-11-02", total_weeks: 18, is_current: true };
const course: Course = { ...syncFields, id: "course", semester_id: semester.id, name: "数学", teacher: "", classroom: "", color: "#e36b32", note: "" };
const schedule: CourseSchedule = { ...syncFields, id: "schedule", course_id: course.id, weekday: 5, start_period: 1, end_period: 1, weeks: [1] };
const period: ClassPeriod = { ...syncFields, id: "period", semester_id: semester.id, weekday: 5, period_number: 1, kind: "period", sort_order: 1, name: "第一节", start_time: "09:00", end_time: "10:00" };

describe("事项时间冲突", () => {
  it("结束时间等于下一项开始时间时不算冲突", () => {
    expect(timeRangesOverlap("17:00", "17:30", "17:30", "19:00")).toBe(false);
    expect(timeRangesOverlap("17:30", "19:00", "19:00", "20:30")).toBe(false);
  });

  it("时间区间实际相交时仍算冲突", () => {
    expect(timeRangesOverlap("17:00", "18:00", "17:30", "19:00")).toBe(true);
  });

  it("新建定时事项忽略当天的全天事项，仍检查定时事项", () => {
    expect(findEventConflicts(timedEvent, [allDayEvent, existingEvent]).map((item) => item.id)).toEqual([existingEvent.id]);
  });

  it("多个跨日或重复全天事项不会占用冲突结果名额", () => {
    const allDayEvents = Array.from({ length: 6 }, (_, index): EventItem => ({
      ...allDayEvent,
      id: `all-day-${index}`,
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      recurrence_type: index % 2 ? "daily" : "none",
      recurrence_until: "2026-11-30"
    }));
    expect(findEventConflicts(timedEvent, [...allDayEvents, existingEvent]).map((item) => item.id)).toEqual([existingEvent.id]);
  });

  it("新建全天事项不与已有定时或全天事项冲突", () => {
    expect(findEventConflicts({ ...allDayEvent, id: "new-all-day" }, [existingEvent, allDayEvent])).toEqual([]);
  });

  it("全天事项不与课程冲突，定时事项仍检查课程", () => {
    expect(findEventCourseConflicts(allDayEvent, semester, [course], [schedule], [period])).toEqual([]);
    expect(findEventCourseConflicts(timedEvent, semester, [course], [schedule], [period]).map((item) => item.id)).toEqual([schedule.id]);
  });

  it("课程检查已有事项时也忽略全天事项", () => {
    expect(findCourseEventConflicts(semester, [schedule], [period], [allDayEvent, existingEvent]).map((item) => item.id)).toEqual([existingEvent.id]);
  });

  it("定时事项仍按日期和实际相交的时段判断冲突", () => {
    expect(findEventConflicts(timedEvent, [
      { ...existingEvent, id: "adjacent", start_time: "10:00", end_time: "11:00" },
      { ...existingEvent, id: "tomorrow", start_date: "2026-11-07", end_date: "2026-11-07" },
      { ...existingEvent, id: "deleted", deleted_at: syncFields.updated_at },
      timedEvent
    ])).toEqual([]);
  });
});
