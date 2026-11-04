import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassPeriod, Course, CourseSchedule, EventItem, Semester, SyncFields } from "../types";
import { buildSnapshotDays, exportScheduleSnapshot, type SnapshotDay, type SnapshotScheduleItem } from "./scheduleSnapshot";

vi.mock("./fileExport", () => ({
  canvasToPngBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
  exportBlob: vi.fn(async () => ({ saved: true }))
}));

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

  it("日期范围事项每天保留相同时段，并仅保留已配置的休息时段", () => {
    const event: EventItem = {
      ...fields, event_type: "event", title: "连续三天实验", start_date: "2026-10-19", end_date: "2026-10-21", start_time: "09:00", end_time: "10:00", all_day: false,
      category_id: null, color: "#3157d5", note: "", recurrence_type: "none", recurrence_until: null, recurrence_interval: 1,
      reminder_enabled: false, reminder_minutes_before: 10, timezone: "Asia/Shanghai"
    };
    const rest: ClassPeriod = { ...fields, semester_id: "semester-1", weekday: 1, period_number: 0, kind: "break", sort_order: 5, name: "午休", start_time: "12:00", end_time: "13:30" };
    const input = { semester: null, courses: [], schedules: [], cancellations: [], events: [event], categories: [], occurrenceStates: [], periods: [rest, { ...rest, id: "deleted-rest", name: "已删休息", deleted_at: fields.created_at }] };
    const days = buildSnapshotDays(input, [new Date(2026, 9, 19), new Date(2026, 9, 20), new Date(2026, 9, 21)]);
    expect(days.map((day) => [day.items[0].startMinute, day.items[0].endMinute])).toEqual([[540, 600], [540, 600], [540, 600]]);
    expect(days[0].items[0].continuation).toBe("10/19–10/21");
    expect(days[0].restPeriods).toEqual([{ name: "午休", startMinute: 720, endMinute: 810 }]);
    expect(days[1].restPeriods).toEqual([]);
  });
});

interface TextDraw { text: string; x: number; y: number; }

function mockSnapshotCanvas() {
  const text: TextDraw[] = [];
  const rectangles: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const context = {
    fillStyle: "", strokeStyle: "", font: "", lineWidth: 1, globalAlpha: 1,
    beginPath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    measureText: vi.fn((value: string) => ({ width: Array.from(value).reduce((width, character) => width + (/[\u3400-\u9fff]/.test(character) ? 1 : 0.55), 0) * Number(context.font.match(/(\d+)px/)?.[1] ?? 20) })),
    fillText: vi.fn((value: string, x: number, y: number) => text.push({ text: value, x, y })),
    roundRect: vi.fn((x: number, y: number, width: number, height: number) => rectangles.push({ x, y, width, height, color: context.fillStyle }))
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return { text, rectangles, canvases };
}

function snapshotItem(title: string, startMinute: number, endMinute: number): SnapshotScheduleItem {
  return { id: title, title, time: "09:00-10:00", detail: "33-133", details: ["33-133", "张老师"], color: "#3157d5", completed: false, kind: "course", startMinute, endMinute };
}

function snapshotDays(items: SnapshotScheduleItem[] = []): SnapshotDay[] {
  return Array.from({ length: 7 }, (_, index) => ({ date: new Date(2026, 9, 19 + index), items: index === 0 ? items : [] }));
}

describe("手机周快照渲染", () => {
  afterEach(() => vi.restoreAllMocks());

  it("电脑默认保持1680×1080，手机竖图完整绘制超过8项并随内容增高", async () => {
    const drawn = mockSnapshotCanvas();
    const items = Array.from({ length: 12 }, (_, index) => snapshotItem(`课${index + 1}`, 540 + index * 2, 541 + index * 2));
    const options = { mode: "week" as const, days: snapshotDays(items), skinId: "default" as const, title: "周日程", fileName: "周快照" };
    await exportScheduleSnapshot(options);
    expect([drawn.canvases[0].width, drawn.canvases[0].height]).toEqual([1680, 1080]);
    expect(drawn.text.some((draw) => draw.text === "另有 4 项")).toBe(true);

    drawn.text.length = 0;
    await exportScheduleSnapshot({ ...options, layout: "mobile" });
    const mobile = drawn.canvases[1];
    expect(mobile.width).toBe(1080);
    expect(mobile.height).toBeGreaterThan(1920);
    for (const item of items) expect(drawn.text.some((draw) => draw.text === item.title)).toBe(true);
    expect(drawn.text.some((draw) => /另有|…/.test(draw.text))).toBe(false);
    expect(drawn.text.filter((draw) => draw.text === "33-133")).toHaveLength(12);
    expect(drawn.text.some((draw) => draw.text === "09:00–09:01")).toBe(true);
    expect(Math.max(...drawn.text.map((draw) => draw.y))).toBeLessThan(mobile.height);
  });

  it("共享真实时间轴，重叠成组显示，全天和配置午休保留", async () => {
    const drawn = mockSnapshotCanvas();
    const days = snapshotDays([snapshotItem("同步甲", 540, 630), snapshotItem("重叠乙", 570, 660), { ...snapshotItem("全天项", 0, 1440), allDay: true, time: "全天" }]);
    days[1].items = [snapshotItem("同步丙", 540, 630), snapshotItem("下午项", 840, 900)];
    days.forEach((day) => { day.restPeriods = [{ name: "午休", startMinute: 720, endMinute: 810 }]; });
    await exportScheduleSnapshot({ mode: "week", days, skinId: "default", title: "周日程", fileName: "周快照", layout: "mobile" });
    expect(drawn.canvases[0].width).toBe(1080);
    expect(drawn.canvases[0].height).toBeGreaterThanOrEqual(1920);
    expect(drawn.canvases[0].height).toBeLessThan(2160);
    const first = drawn.text.find((draw) => draw.text === "同步甲")!;
    const overlap = drawn.text.find((draw) => draw.text === "重叠乙")!;
    const afternoon = drawn.text.find((draw) => draw.text === "下午项")!;
    expect(first.x).toBe(overlap.x);
    expect(first.y).toBeLessThan(overlap.y);
    expect(overlap.y).toBeLessThan(afternoon.y);
    expect(drawn.text.some((draw) => draw.text === "重叠 2 项")).toBe(true);
    expect(drawn.text.some((draw) => draw.text === "全天项")).toBe(true);
    expect(drawn.text.filter((draw) => draw.text === "午休")).toHaveLength(1);
    expect(drawn.text.some((draw) => draw.text === "12:00–13:30")).toBe(true);
    const courseCards = drawn.rectangles.filter((rect) => rect.color === "#c1cdf2");
    expect(courseCards).toHaveLength(5);
    expect(courseCards.every((rect) => rect.width > 120 && rect.height >= 114)).toBe(true);
    const overlapFrame = drawn.rectangles.find((rect) => rect.width > courseCards[0].width && rect.width < courseCards[0].width + 5)!;
    const sameTimeOtherDay = courseCards.find((rect) => rect.x > courseCards[0].x)!;
    expect(overlapFrame.y + 2).toBe(sameTimeOtherDay.y);
  });
});
