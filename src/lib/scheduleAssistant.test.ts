import { describe, expect, it } from "vitest";
import type { Category, ClassPeriod, Course, CourseCancellation, CourseSchedule, EventItem, EventOccurrenceState, FocusSession, Semester } from "../types";
import { answerScheduleQuestion } from "./scheduleAssistant";

const baseFields = {
  user_id: "local",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test"
};

const semester: Semester = {
  ...baseFields,
  id: "semester",
  name: "测试学期",
  start_date: "2026-07-06",
  total_weeks: 20,
  is_current: true
};

const course: Course = {
  ...baseFields,
  id: "course-1",
  semester_id: semester.id,
  name: "高数",
  teacher: "张老师",
  classroom: "A101",
  color: "#3157d5",
  note: ""
};

const schedule: CourseSchedule = {
  ...baseFields,
  id: "schedule-1",
  course_id: course.id,
  weekday: 3,
  start_period: 1,
  end_period: 2,
  weeks: [1, 2, 3]
};

const periods: ClassPeriod[] = [
  { ...baseFields, id: "period-1", semester_id: semester.id, weekday: 3, period_number: 1, kind: "period", sort_order: 1, name: "第一节", start_time: "08:00", end_time: "08:45" },
  { ...baseFields, id: "period-2", semester_id: semester.id, weekday: 3, period_number: 2, kind: "period", sort_order: 2, name: "第二节", start_time: "08:55", end_time: "09:40" }
];

const eventItem: EventItem = {
  ...baseFields,
  id: "event-1",
  event_type: "event",
  title: "交作业",
  start_date: "2026-07-08",
  end_date: "2026-07-08",
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
  reminder_minutes_before: 10,
  timezone: "Asia/Shanghai"
};

const focusSession: FocusSession = {
  ...baseFields,
  id: "focus-1",
  mode: "stopwatch",
  task_title: "交作业",
  linked_event_id: eventItem.id,
  planned_seconds: null,
  duration_seconds: 1800,
  started_at: "2026-07-08T10:00:00.000+08:00",
  ended_at: "2026-07-08T10:30:00.000+08:00",
  completed: true,
  interrupted: false
};

const input = {
  semester,
  courses: [course],
  schedules: [schedule],
  cancellations: [] as CourseCancellation[],
  events: [eventItem],
  categories: [] as Category[],
  occurrenceStates: [] as EventOccurrenceState[],
  periods,
  focusSessions: [focusSession],
  now: new Date(2026, 6, 8, 12, 0, 0)
};

describe("本地问日程助手", () => {
  it("回答今天安排和未完成事项", () => {
    expect(answerScheduleQuestion("今天有什么安排？", input)).toContain("交作业");
    expect(answerScheduleQuestion("今天有哪些未完成事项？", input)).toContain("交作业");
  });

  it("回答课程教室", () => {
    const answer = answerScheduleQuestion("高数在哪个教室？", input);
    expect(answer).toContain("A101");
    expect(answer).toContain("张老师");
  });

  it("回答完成率和专注统计", () => {
    expect(answerScheduleQuestion("这周完成率多少？", input)).toContain("完成率 0%");
    expect(answerScheduleQuestion("今天专注了多久？", input)).toContain("30:00");
  });

  it("回答冲突检查", () => {
    const answer = answerScheduleQuestion("今天有冲突吗？", {
      ...input,
      events: [
        eventItem,
        { ...eventItem, id: "event-2", title: "开会", start_time: "09:30", end_time: "10:30" }
      ]
    });
    expect(answer).toContain("交作业 与 开会");
  });
});
