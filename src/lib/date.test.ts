import { describe, expect, it } from "vitest";
import type { CourseSchedule, Semester } from "../types";
import {
  courseScheduleOccursOn,
  eventOccursOn,
  semesterWeekForDate,
  startOfWeek,
  toISODate,
  weekDates
} from "./date";

const baseFields = {
  id: "id",
  user_id: "local",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test-device"
};

const semester: Semester = {
  ...baseFields,
  name: "测试学期",
  start_date: "2026-03-02",
  total_weeks: 18,
  is_current: true
};

const schedule: CourseSchedule = {
  ...baseFields,
  id: "schedule",
  course_id: "course",
  weekday: 1,
  start_period: 1,
  end_period: 2,
  weeks: [1, 2, 4, 8, 18]
};

describe("周日期计算", () => {
  it("以星期一作为每周第一天", () => {
    expect(toISODate(startOfWeek(new Date(2026, 2, 8)))).toBe("2026-03-02");
    expect(weekDates(new Date(2026, 2, 8)).map(toISODate)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08"
    ]);
  });

  it("正确计算学期周数和学期外日期", () => {
    expect(semesterWeekForDate(semester, new Date(2026, 2, 2))).toBe(1);
    expect(semesterWeekForDate(semester, new Date(2026, 2, 30))).toBe(5);
    expect(semesterWeekForDate(semester, new Date(2026, 1, 28))).toBeNull();
    expect(semesterWeekForDate(semester, new Date(2026, 6, 6))).toBeNull();
  });
});

describe("课程任意周数", () => {
  it("只在指定周的指定星期出现", () => {
    expect(courseScheduleOccursOn(schedule, semester, new Date(2026, 2, 2))).toBe(true);
    expect(courseScheduleOccursOn(schedule, semester, new Date(2026, 2, 9))).toBe(true);
    expect(courseScheduleOccursOn(schedule, semester, new Date(2026, 2, 16))).toBe(false);
    expect(courseScheduleOccursOn(schedule, semester, new Date(2026, 2, 23))).toBe(true);
    expect(courseScheduleOccursOn(schedule, semester, new Date(2026, 2, 24))).toBe(false);
  });
});

describe("事项重复", () => {
  it("不重复事项在开始到结束日期之间每天出现", () => {
    const event = {
      start_date: "2026-07-25",
      end_date: "2026-07-27",
      recurrence_type: "none" as const,
      recurrence_until: null,
      recurrence_interval: 1
    };
    expect(eventOccursOn(event, new Date(2026, 6, 24))).toBe(false);
    expect(eventOccursOn(event, new Date(2026, 6, 25))).toBe(true);
    expect(eventOccursOn(event, new Date(2026, 6, 26))).toBe(true);
    expect(eventOccursOn(event, new Date(2026, 6, 27))).toBe(true);
    expect(eventOccursOn(event, new Date(2026, 6, 28))).toBe(false);
  });

  it("每周事项按开始日期的星期重复，并遵守截止日期", () => {
    const event = {
      start_date: "2026-03-04",
      end_date: "2026-03-04",
      recurrence_type: "weekly" as const,
      recurrence_until: "2026-03-25",
      recurrence_interval: 1
    };
    expect(eventOccursOn(event, new Date(2026, 2, 4))).toBe(true);
    expect(eventOccursOn(event, new Date(2026, 2, 11))).toBe(true);
    expect(eventOccursOn(event, new Date(2026, 2, 12))).toBe(false);
    expect(eventOccursOn(event, new Date(2026, 3, 1))).toBe(false);
  });

  it("支持工作日、每月同日和自定义间隔重复", () => {
    expect(eventOccursOn({
      start_date: "2026-03-02",
      end_date: "2026-03-02",
      recurrence_type: "weekdays",
      recurrence_until: "2026-03-08",
      recurrence_interval: 1
    }, new Date(2026, 2, 7))).toBe(false);
    expect(eventOccursOn({
      start_date: "2026-03-15",
      end_date: "2026-03-15",
      recurrence_type: "monthly",
      recurrence_until: "2026-05-31",
      recurrence_interval: 1
    }, new Date(2026, 4, 15))).toBe(true);
    expect(eventOccursOn({
      start_date: "2026-03-01",
      end_date: "2026-03-01",
      recurrence_type: "interval",
      recurrence_until: "2026-03-10",
      recurrence_interval: 3
    }, new Date(2026, 2, 7))).toBe(true);
  });
});
