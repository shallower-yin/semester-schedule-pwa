import { describe, expect, it } from "vitest";
import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  FocusSession,
  Semester
} from "../types";
import { buildScheduleOverview } from "./overview";

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
  id: "semester",
  name: "测试学期",
  start_date: "2026-03-02",
  total_weeks: 18,
  is_current: true
};

const periods: ClassPeriod[] = [
  {
    ...baseFields,
    id: "period-1",
    semester_id: "semester",
    weekday: 1,
    period_number: 1,
    kind: "period",
    sort_order: 1,
    name: "第一节",
    start_time: "08:30",
    end_time: "09:15"
  },
  {
    ...baseFields,
    id: "period-2",
    semester_id: "semester",
    weekday: 1,
    period_number: 2,
    kind: "period",
    sort_order: 2,
    name: "第二节",
    start_time: "09:20",
    end_time: "10:05"
  }
];

describe("首页日程概览", () => {
  it("统计今日课程事项、完成状态和本周专注时长", () => {
    const courses: Course[] = [
      {
        ...baseFields,
        id: "course-1",
        semester_id: "semester",
        name: "数学",
        teacher: "王老师",
        classroom: "A101",
        color: "#3157d5",
        note: ""
      },
      {
        ...baseFields,
        id: "course-2",
        semester_id: "semester",
        name: "英语",
        teacher: "",
        classroom: "B201",
        color: "#e36b32",
        note: ""
      }
    ];
    const schedules: CourseSchedule[] = [
      { ...baseFields, id: "schedule-1", course_id: "course-1", weekday: 1, start_period: 1, end_period: 2, weeks: [1] },
      { ...baseFields, id: "schedule-2", course_id: "course-2", weekday: 1, start_period: 1, end_period: 1, weeks: [1] }
    ];
    const cancellations: CourseCancellation[] = [
      { ...baseFields, id: "cancel-1", course_schedule_id: "schedule-2", occurrence_date: "2026-03-02", reason: "停课" }
    ];
    const categories: Category[] = [
      { ...baseFields, id: "category-1", name: "学习", color: "#7c3aed", icon: "book-open" }
    ];
    const events: EventItem[] = [
      {
        ...baseFields,
        id: "event-1",
        event_type: "event",
        title: "背单词",
        start_date: "2026-03-02",
        start_time: null,
        end_date: "2026-03-02",
        end_time: null,
        all_day: true,
        category_id: "category-1",
        color: "",
        note: "",
        recurrence_type: "none",
        recurrence_until: null,
        recurrence_interval: 1,
        reminder_enabled: false,
        reminder_minutes_before: 0,
        timezone: "Asia/Shanghai"
      },
      {
        ...baseFields,
        id: "event-2",
        event_type: "event",
        title: "提交作业",
        start_date: "2026-03-02",
        start_time: "10:30",
        end_date: "2026-03-02",
        end_time: "10:30",
        all_day: false,
        category_id: null,
        color: "#e36b32",
        note: "",
        recurrence_type: "none",
        recurrence_until: null,
        recurrence_interval: 1,
        reminder_enabled: true,
        reminder_minutes_before: 10,
        timezone: "Asia/Shanghai"
      }
    ];
    const occurrenceStates: EventOccurrenceState[] = [
      { ...baseFields, id: "state-1", event_id: "event-1", occurrence_date: "2026-03-02", completed: true, reminder_sent_at: null }
    ];
    const focusSessions: FocusSession[] = [
      {
        ...baseFields,
        id: "focus-today",
        mode: "pomodoro",
        task_title: "复习",
        linked_event_id: null,
        planned_seconds: 1500,
        duration_seconds: 1500,
        started_at: "2026-03-02T08:00:00.000+08:00",
        ended_at: "2026-03-02T08:25:00.000+08:00",
        completed: true,
        interrupted: false
      },
      {
        ...baseFields,
        id: "focus-week",
        mode: "stopwatch",
        task_title: "整理",
        linked_event_id: null,
        planned_seconds: null,
        duration_seconds: 600,
        started_at: "2026-03-03T08:00:00.000+08:00",
        ended_at: "2026-03-03T08:10:00.000+08:00",
        completed: true,
        interrupted: false
      }
    ];

    const overview = buildScheduleOverview(
      { semester, courses, schedules, cancellations, events, categories, occurrenceStates, periods, focusSessions },
      new Date(2026, 2, 2, 9, 0)
    );

    expect(overview.todayItemCount).toBe(3);
    expect(overview.todayCourseCount).toBe(1);
    expect(overview.todayEventCount).toBe(2);
    expect(overview.todayIncompleteEventCount).toBe(1);
    expect(overview.todayCompletedEventCount).toBe(1);
    expect(overview.weekEventCount).toBe(2);
    expect(overview.weekCompletedEventCount).toBe(1);
    expect(overview.weekCompletionRate).toBe(50);
    expect(overview.todayFocusSeconds).toBe(1500);
    expect(overview.weekFocusSeconds).toBe(2100);
    expect(overview.upcomingItems.map((item) => item.title)).toEqual(["背单词", "数学", "提交作业"]);
    expect(overview.upcomingItems.find((item) => item.title === "数学")?.targetId).toBe("course-1");
    expect(overview.upcomingItems.find((item) => item.title === "提交作业")?.targetId).toBe("event-2");
    expect(overview.weekFocusTrend.map((item) => item.totalSeconds)).toEqual([1500, 600, 0, 0, 0, 0, 0]);
    expect(overview.weekFocusTrend[0]).toMatchObject({ date: "2026-03-02", isToday: true });
    expect(overview.overdueIncompleteItems).toEqual([]);
  });

  it("列出最近逾期未完成事项", () => {
    const events: EventItem[] = [
      {
        ...baseFields,
        id: "event-overdue",
        event_type: "event",
        title: "补交材料",
        start_date: "2026-03-04",
        start_time: "18:00",
        end_date: "2026-03-04",
        end_time: "18:00",
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
      },
      {
        ...baseFields,
        id: "event-completed",
        event_type: "event",
        title: "已完成旧事项",
        start_date: "2026-03-05",
        start_time: null,
        end_date: "2026-03-05",
        end_time: null,
        all_day: true,
        category_id: null,
        color: "#3157d5",
        note: "",
        recurrence_type: "none",
        recurrence_until: null,
        recurrence_interval: 1,
        reminder_enabled: false,
        reminder_minutes_before: 10,
        timezone: "Asia/Shanghai"
      }
    ];
    const occurrenceStates: EventOccurrenceState[] = [
      { ...baseFields, id: "state-completed", event_id: "event-completed", occurrence_date: "2026-03-05", completed: true, reminder_sent_at: null }
    ];

    const overview = buildScheduleOverview(
      { semester, courses: [], schedules: [], cancellations: [], events, categories: [], occurrenceStates, periods, focusSessions: [] },
      new Date(2026, 2, 6, 9, 0)
    );

    expect(overview.overdueIncompleteItems.map((item) => item.title)).toEqual(["补交材料"]);
    expect(overview.overdueIncompleteItems[0]).toMatchObject({
      targetId: "event-overdue",
      timeLabel: "3/4 18:00–18:00"
    });
  });
});
