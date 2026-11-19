import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { ClassPeriod, Course, CourseCancellation, CourseSchedule, Semester } from "../types";
import { setCurrentUserId } from "./identity";
import { checkDueLocalReminders } from "./notifications";
import { computeCourseReminders, computeScheduledReminders, type CourseReminderInput } from "./reminderSchedule";

vi.mock("./nativeApp", () => ({ isNativeApp: () => false }));
const fields = { user_id: "local", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", deleted_at: null, version: 1, device_id: "test-device" };
const semester: Semester = { ...fields, id: "semester", name: "秋季", start_date: "2026-11-18", total_weeks: 3, is_current: true };
const course: Course = { ...fields, id: "course", semester_id: semester.id, name: "新材料制造学", teacher: "林彬", classroom: "55楼A区308", color: "#8958ee", note: "", reminder_enabled: true, reminder_minutes_before: 10 };
const schedule: CourseSchedule = { ...fields, id: "schedule", course_id: course.id, weekday: 4, start_period: 1, end_period: 2, weeks: [1, 3] };
const period: ClassPeriod = { ...fields, id: "period", semester_id: semester.id, weekday: 4, period_number: 1, kind: "period", sort_order: 1, name: "第一节", start_time: "08:30", end_time: "09:15" };
const cancellation: CourseCancellation = { ...fields, id: "cancel", course_schedule_id: schedule.id, occurrence_date: "2026-11-19", reason: "停课" };
function input(overrides: CourseReminderInput = {}): CourseReminderInput {
  return { semesters: [semester], courses: [course], courseSchedules: [schedule], periods: [period], courseCancellations: [], ...overrides };
}
const from = new Date("2026-11-18T00:00:00+08:00");
const until = new Date("2026-12-10T00:00:00+08:00");

describe("课程提醒计算", () => {
  it("按实际选中周数和星期生成提醒，内容含课程和教室", () => {
    const reminders = computeCourseReminders(input(), from, until);
    expect(reminders.map((item) => item.key)).toEqual(["course:course:schedule:2026-11-19", "course:course:schedule:2026-12-03"]);
    expect(reminders[0]).toMatchObject({ title: "新材料制造学", body: "2026-11-19 08:30 开始 · 55楼A区308", at: new Date("2026-11-19T08:20:00+08:00") });
    expect(computeScheduledReminders({ ...input(), events: [], anniversaries: [], occurrenceStates: [], now: from })).toHaveLength(2);
  });

  it("课程可独立设置提前时间，多次上课分别提醒", () => {
    const second = { ...course, id: "second", reminder_minutes_before: 30 };
    const secondSchedule = { ...schedule, id: "second-schedule", course_id: second.id };
    const result = computeCourseReminders(input({ courses: [course, second], courseSchedules: [schedule, secondSchedule] }), from, until);
    expect(result).toHaveLength(4);
    expect(result.find((item) => item.key.startsWith("course:second:"))?.at).toEqual(new Date("2026-11-19T08:00:00+08:00"));
    expect(computeCourseReminders(input({ courses: [{ ...course, reminder_enabled: false }, second], courseSchedules: [schedule, secondSchedule] }), from, until)).toHaveLength(2);
  });

  it("停课时跳过该次提醒，恢复后仍按原设置提醒", () => {
    expect(computeCourseReminders(input({ courseCancellations: [cancellation] }), from, until)).toHaveLength(1);
    expect(computeCourseReminders(input({ courseCancellations: [{ ...cancellation, deleted_at: fields.created_at }] }), from, until)).toHaveLength(2);
  });

  it("跳过学期开始前、已删课程、无效节次和其他账号安排", () => {
    expect(computeCourseReminders(input({ courseSchedules: [{ ...schedule, weekday: 1 }], periods: [{ ...period, weekday: 1 }] }), from, until)).toHaveLength(1);
    expect(computeCourseReminders(input({ courses: [{ ...course, deleted_at: fields.created_at }] }), from, until)).toHaveLength(0);
    expect(computeCourseReminders(input({ periods: [{ ...period, kind: "break" }] }), from, until)).toHaveLength(0);
    expect(computeCourseReminders(input({ courseSchedules: [{ ...schedule, user_id: "other" }] }), from, until)).toHaveLength(0);
  });

  it("支持提前七天提醒且不受设备时区影响", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const result = computeCourseReminders(input({ courses: [{ ...course, reminder_minutes_before: 10080 }] }), new Date("2026-11-12T08:00:00+08:00"), new Date("2026-11-12T09:00:00+08:00"));
      expect(result).toHaveLength(1);
      expect(result[0].at).toEqual(new Date("2026-11-12T08:30:00+08:00"));
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("浏览器课程提醒", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T08:20:00+08:00"));
    await Promise.all([db.courses.clear(), db.semesters.clear(), db.courseSchedules.clear(), db.courseCancellations.clear(), db.classPeriods.clear(), db.events.clear(), db.anniversaries.clear(), db.todos.clear(), db.eventOccurrenceStates.clear()]);
    await Promise.all([db.courses.put(course), db.semesters.put(semester), db.courseSchedules.put(schedule), db.classPeriods.put(period)]);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("发送并持久去重，通知携带对应课程的跳转地址", async () => {
    const showNotification = vi.fn(async () => {});
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ showNotification }) } });
    expect(await checkDueLocalReminders("local")).toBe(1);
    expect(showNotification).toHaveBeenCalledWith(course.name, expect.objectContaining({ body: "2026-11-19 08:30 开始 · 55楼A区308", data: { url: expect.stringContaining("course%3Acourse%3Aschedule%3A2026-11-19") } }));
    expect(await checkDueLocalReminders("local")).toBe(0);
    expect(showNotification).toHaveBeenCalledOnce();
  });

  it("停课和通知权限被拒绝时均不发送", async () => {
    const showNotification = vi.fn(async () => {});
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ showNotification }) } });
    await db.courseCancellations.put(cancellation);
    expect(await checkDueLocalReminders("local")).toBe(0);
    await db.courseCancellations.clear();
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(await checkDueLocalReminders("local")).toBe(0);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("同时检查提醒时只投递一次", async () => {
    let finish!: () => void;
    const delivery = new Promise<void>((resolve) => { finish = resolve; });
    const showNotification = vi.fn(() => delivery);
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ showNotification }) } });
    const checks = [checkDueLocalReminders("local"), checkDueLocalReminders("local")];
    try {
      await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
    } finally { finish(); }
    expect((await Promise.all(checks)).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(showNotification).toHaveBeenCalledOnce();
  });
});
