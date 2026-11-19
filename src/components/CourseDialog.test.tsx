import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setCurrentUserId } from "../lib/identity";
import { enableNotifications } from "../lib/notifications";
import type { Course, Semester } from "../types";
import { CourseDialog } from "./CourseDialog";

vi.mock("../lib/notifications", () => ({ enableNotifications: vi.fn() }));

const fields = {
  user_id: "local", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
  deleted_at: null, version: 1, device_id: "test-device"
};
const semester: Semester = { ...fields, id: "semester-1", name: "秋季", start_date: "2026-11-16", total_weeks: 3, is_current: true };
const course: Course = { ...fields, id: "course-1", semester_id: semester.id, name: "新材料制造学", teacher: "林彬", classroom: "55楼A区308", color: "#8958ee", note: "", reminder_enabled: true, reminder_minutes_before: 15 };

beforeEach(async () => {
  setCurrentUserId("local");
  vi.mocked(enableNotifications).mockReset().mockResolvedValue("enabled");
  await Promise.all([db.courses.clear(), db.courseSchedules.clear(), db.courseCancellations.clear(), db.classPeriods.clear(), db.events.clear(), db.syncQueue.clear()]);
  await db.classPeriods.bulkPut([1, 2].map((number) => ({ ...fields, id: `period-${number}`, semester_id: semester.id, weekday: 1 as const, period_number: number, kind: "period" as const, sort_order: number, name: `第${number}节`, start_time: number === 1 ? "08:30" : "09:25", end_time: number === 1 ? "09:15" : "10:10" })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("课程独立提醒", () => {
  it("使用普通事项的提醒控件并只保存当前课程的设置", async () => {
    const other = { ...course, id: "course-2", name: "另一门课", reminder_enabled: false };
    await db.courses.bulkPut([course, other]);
    await db.courseSchedules.put({ ...fields, id: "schedule-1", course_id: course.id, weekday: 1, start_period: 1, end_period: 2, weeks: [1, 3] });
    const onClose = vi.fn();
    render(<CourseDialog semester={semester} course={course} onClose={onClose} />);
    expect(screen.getByRole("checkbox", { name: "提醒我" })).toBeChecked();
    expect(screen.getByLabelText("提前时间")).toHaveValue("15");
    expect(screen.getByRole("option", { name: "提前 7 天" })).toHaveValue("10080");
    await waitFor(() => expect(screen.getByText("上课周数（已选 2 周）")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("提前时间"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存课程" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(await db.courses.get(course.id)).toMatchObject({ reminder_enabled: true, reminder_minutes_before: 30 });
    expect(await db.courses.get(other.id)).toEqual(other);
    expect((await db.syncQueue.toArray()).some((item) => item.table_name === "courses" && item.record_id === course.id)).toBe(true);
  });

  it("旧课程默认关闭提醒，可以单独开启并保存", async () => {
    const legacy = { ...course, reminder_enabled: undefined, reminder_minutes_before: undefined };
    await db.courses.put(legacy);
    render(<CourseDialog semester={semester} course={legacy} onClose={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "提醒我" })).not.toBeChecked();
    expect(screen.queryByLabelText("提前时间")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "提醒我" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存课程" })).not.toBeDisabled());
    expect(enableNotifications).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("提前时间")).toHaveValue("10");
    await waitFor(() => expect(screen.getByLabelText("开始节次")).toHaveValue("1"));
    fireEvent.click(screen.getByRole("button", { name: "保存课程" }));
    await waitFor(async () => expect(await db.courses.get(course.id)).toMatchObject({ reminder_enabled: true, reminder_minutes_before: 10 }));
  });

  it("通知权限被拒绝时恢复关闭状态并给出操作提示", async () => {
    vi.mocked(enableNotifications).mockResolvedValue("denied");
    render(<CourseDialog semester={semester} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "提醒我" }));
    expect(await screen.findByRole("status")).toHaveTextContent("允许通知");
    expect(screen.getByRole("checkbox", { name: "提醒我" })).not.toBeChecked();
    expect(screen.queryByLabelText("提前时间")).not.toBeInTheDocument();
  });
});
