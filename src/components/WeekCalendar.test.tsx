import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { weekDates } from "../lib/date";
import type { ClassPeriod, EventItem, EventOccurrenceState, Semester } from "../types";
import { WeekCalendar } from "./WeekCalendar";

const baseFields = {
  user_id: "local",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test-device"
};

const semester: Semester = {
  ...baseFields,
  id: "semester-1",
  name: "2026夏",
  start_date: "2026-07-06",
  total_weeks: 16,
  is_current: true
};

const periods: ClassPeriod[] = [
  {
    ...baseFields,
    id: "period-1",
    semester_id: semester.id,
    weekday: 1,
    period_number: 1,
    kind: "period",
    sort_order: 1,
    name: "第一节",
    start_time: "08:30",
    end_time: "09:15"
  }
];

describe("周视图移动端新增事项", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("无安排时长按午休空白格可新增，并抑制随后触发的普通点击", () => {
    const onAddEvent = vi.fn();
    renderWeekCalendar(onAddEvent, [], semester, []);

    const cell = screen.getByLabelText("7月7日 12:00–13:30新增事项");
    fireEvent.pointerDown(cell, { pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(530);
    });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);

    expect(onAddEvent).toHaveBeenCalledTimes(1);
    expect(onAddEvent).toHaveBeenCalledWith("2026-07-07", "12:00", "13:30");
  });

  it("长按过程中取消触控不会新增事项", () => {
    const onAddEvent = vi.fn();
    renderWeekCalendar(onAddEvent);

    const cell = screen.getByLabelText("7月7日 08:30–09:15新增事项");
    fireEvent.pointerDown(cell, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(cell);
    act(() => {
      vi.advanceTimersByTime(530);
    });

    expect(onAddEvent).not.toHaveBeenCalled();
  });

  it("48像素内三项确实拥挤时整体汇总，列表仍能逐项编辑和新增", () => {
    const onAddEvent = vi.fn();
    const onEditEvent = vi.fn();
    renderWeekCalendar(onAddEvent, [
      eventRecord("event-a", "重叠事项 A"),
      eventRecord("event-b", "重叠事项 B"),
      eventRecord("event-c", "重叠事项 C")
    ], semester, periods, [], vi.fn(), { onEditEvent });

    const group = screen.getByRole("group", { name: "8:30–9:15，3项安排" });
    expect(Number.parseFloat(group.style.height)).toBe(48);
    fireEvent.click(screen.getByRole("button", { name: "查看3项安排" }));
    expect(screen.getByRole("button", { name: "新增事项" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑事项：重叠事项 C" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：重叠事项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "查看3项安排" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：重叠事项 B" }));
    expect(onEditEvent.mock.calls.map(([event]) => event.id)).toEqual(["event-a", "event-b"]);
  });

  it("96像素可叠放时最长课程作底板，短项位于标题之后且两者都能直接编辑", () => {
    const onEditCourse = vi.fn();
    const onEditEvent = vi.fn();
    const secondPeriod: ClassPeriod = { ...periods[0], id: "period-2", period_number: 2, name: "第二节", start_time: "09:20", end_time: "10:05" };
    const course = { ...baseFields, id: "long-course", semester_id: semester.id, name: "上午长课程", classroom: "C204", teacher: "王老师", color: "#6385a6", note: "" };
    const short = eventRecord("short-event", "短事项", { start_time: "09:00", end_time: "09:10" });
    renderWeekCalendar(vi.fn(), [short], semester, [periods[0], secondPeriod], [], vi.fn(), {
      courses: [course],
      schedules: [{ ...baseFields, id: "long-schedule", course_id: course.id, weekday: 1, start_period: 1, end_period: 2, weeks: [1] }],
      onEditCourse,
      onEditEvent
    });
    const base = screen.getByRole("button", { name: "编辑课程：上午长课程" });
    const front = screen.getByRole("button", { name: "编辑事项：短事项" });
    const caption = base.querySelector<HTMLElement>(".mobile-week-layer-caption")!;
    const group = base.closest(".mobile-week-time-group") as HTMLElement;
    expect(base).toHaveClass("mobile-week-layer-base");
    expect(base).toHaveAttribute("data-layer-role", "base");
    expect(front).toHaveClass("mobile-week-layer-front");
    expect(front).toHaveAttribute("data-layer-role", "front");
    expect(Number.parseFloat(group.style.height)).toBe(96);
    expect(Number.parseFloat(caption.style.height)).toBe(48);
    expect(Number.parseFloat(front.style.top)).toBe(52);
    expect(Number.parseFloat(front.style.height)).toBe(44);
    expect(Number.parseFloat(front.style.top)).toBeGreaterThanOrEqual(Number.parseFloat(caption.style.height) + 4);
    expect(Number.parseFloat(front.style.top) + 44).toBeLessThanOrEqual(96);
    fireEvent.click(front);
    fireEvent.click(base);
    expect(onEditEvent).toHaveBeenCalledWith(short);
    expect(onEditCourse).toHaveBeenCalledWith(course);
    expect(screen.queryByRole("dialog", { name: "选择日程" })).not.toBeInTheDocument();
  });

  it("192像素长项保留72像素标题，短浮卡放在76像素处且不影响下一时段或跨日位置", () => {
    const { container } = renderWeekCalendar(vi.fn(), [
      eventRecord("long", "下午长事项", { start_time: "13:30", end_time: "17:00" }),
      eventRecord("short", "下午短事项", { start_time: "14:00", end_time: "14:10" }),
      eventRecord("next", "晚间下一事项", { start_time: "17:00", end_time: "18:30" }),
      eventRecord("other-long", "次日下午长事项", { start_date: "2026-07-07", end_date: "2026-07-07", start_time: "13:30", end_time: "17:00" }),
      eventRecord("other-next", "次日晚间事项", { start_date: "2026-07-07", end_date: "2026-07-07", start_time: "17:00", end_time: "18:30" })
    ], semester, []);
    const base = screen.getByRole("button", { name: "编辑事项：下午长事项" });
    const front = screen.getByRole("button", { name: "编辑事项：下午短事项" });
    const caption = base.querySelector<HTMLElement>(".mobile-week-layer-caption")!;
    const group = base.closest(".mobile-week-time-group") as HTMLElement;
    const otherGroup = screen.getByText("次日下午长事项").closest(".mobile-week-time-group") as HTMLElement;
    const next = screen.getByText("晚间下一事项").closest(".mobile-week-time-group") as HTMLElement;
    const otherNext = screen.getByText("次日晚间事项").closest(".mobile-week-time-group") as HTMLElement;
    expect(Number.parseFloat(group.style.height)).toBe(192);
    expect(Number.parseFloat(caption.style.height)).toBe(72);
    expect(Number.parseFloat(front.style.top)).toBe(76);
    expect(Number.parseFloat(front.style.height)).toBe(44);
    expect(group.style.top).toBe(otherGroup.style.top);
    expect(Number.parseFloat(group.style.top) + 192).toBeLessThanOrEqual(Number.parseFloat(next.style.top));
    expect(next.style.top).toBe(otherNext.style.top);
    expect([...container.querySelectorAll<HTMLElement>(".mobile-week-slot-row")].every((row) => Number.parseFloat(row.style.height) === 48)).toBe(true);
  });

  it("96像素三项只汇总另外两项，列表不重复底板并保留编辑完成和新增", () => {
    const onAddEvent = vi.fn();
    const onEditEvent = vi.fn();
    const onToggleCompleted = vi.fn();
    const long = eventRecord("long", "长底板", { start_time: "08:30", end_time: "10:05" });
    const shortA = eventRecord("short-a", "隐藏短项 A", { start_time: "09:00", end_time: "09:10" });
    const shortB = eventRecord("short-b", "隐藏短项 B", { start_time: "09:25", end_time: "09:35" });
    renderWeekCalendar(onAddEvent, [long, shortA, shortB], semester, [], [], onToggleCompleted, { onEditEvent });
    const base = screen.getByRole("button", { name: "编辑事项：长底板" });
    const summary = screen.getByRole("button", { name: "查看另外2项安排" });
    expect(Number.parseFloat((base.closest(".mobile-week-time-group") as HTMLElement).style.height)).toBe(96);
    expect(Number.parseFloat(summary.style.top)).toBe(52);
    expect(Number.parseFloat(summary.style.height)).toBe(44);
    fireEvent.click(summary);
    const dialog = within(screen.getByRole("dialog", { name: "选择日程" }));
    expect(dialog.queryByRole("button", { name: "编辑事项：长底板" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "编辑事项：隐藏短项 A" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "编辑事项：隐藏短项 B" })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "编辑事项：隐藏短项 A" }));
    expect(onEditEvent).toHaveBeenCalledWith(shortA);
    fireEvent.click(screen.getByRole("button", { name: "查看另外2项安排" }));
    const reopened = within(screen.getByRole("dialog", { name: "选择日程" }));
    fireEvent.click(reopened.getByRole("button", { name: "将 隐藏短项 B 标记为已完成" }));
    expect(onToggleCompleted).toHaveBeenCalledWith(shortB, new Date(2026, 6, 6), true);
    expect(reopened.getByText("7月6日 09:00–09:35")).toBeInTheDocument();
    fireEvent.click(reopened.getByRole("button", { name: "新增事项" }));
    expect(onAddEvent).toHaveBeenCalledWith("2026-07-06", "09:00", "09:35");
  });

  it("短项与三重重叠在所属行内合并，不撑高时段或遮挡下一时段", () => {
    const onAddEvent = vi.fn();
    const { container } = renderWeekCalendar(onAddEvent, [
      eventRecord("event-a", "重叠事项 A", { end_time: "08:40" }),
      eventRecord("event-b", "重叠事项 B", { end_time: "08:40" }),
      eventRecord("event-c", "重叠事项 C", { end_time: "08:40" }),
      eventRecord("event-next", "下一件很长很长的事项标题", { start_time: "08:40", end_time: "08:50" }),
      eventRecord("event-other-day", "次日同一时刻", { start_date: "2026-07-07", end_date: "2026-07-07", start_time: "08:40", end_time: "08:50" }),
      eventRecord("event-later", "下一时段安排", { start_time: "09:20", end_time: "09:30" }),
      eventRecord("event-later-other-day", "次日下一时段", { start_date: "2026-07-07", end_date: "2026-07-07", start_time: "09:20", end_time: "09:30" })
    ]);

    const group = screen.getByRole("group", { name: "8:30–8:50，4项安排" });
    const row = container.querySelector<HTMLElement>('.mobile-week-slot-row[data-start-minute="510"]')!;
    const next = screen.getByText("下一时段安排").closest(".mobile-week-time-group") as HTMLElement;
    const otherDay = screen.getByText("次日下一时段").closest(".mobile-week-time-group") as HTMLElement;
    expect(Number.parseFloat(group.style.height)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(group.style.top)).toBeGreaterThanOrEqual(Number.parseFloat(row.style.top));
    expect(Number.parseFloat(group.style.top) + Number.parseFloat(group.style.height)).toBeLessThanOrEqual(Number.parseFloat(row.style.top) + 48);
    expect(Number.parseFloat(group.style.top) + Number.parseFloat(group.style.height)).toBeLessThanOrEqual(Number.parseFloat(next.style.top));
    expect(next.style.top).toBe(otherDay.style.top);
    const cell = screen.getByLabelText("7月6日 08:30–09:15查看4项日程");
    expect(cell.closest(".mobile-week-slot-row")).toHaveStyle("height: 48px");
    fireEvent.click(cell);
    expect(screen.getByRole("button", { name: "编辑事项：重叠事项 C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑事项：重叠事项 A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑事项：重叠事项 B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑事项：次日同一时刻" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增事项" }));
    expect(onAddEvent).toHaveBeenCalledWith("2026-07-06", "08:30", "09:15");
  });

  it("相邻两个十分钟短项合并后不溢出时段，格内仍能逐项编辑", () => {
    const onEditEvent = vi.fn();
    const { container } = renderWeekCalendar(vi.fn(), [
      eventRecord("first", "短事项一", { start_time: "08:30", end_time: "08:40" }),
      eventRecord("second", "短事项二", { start_time: "08:40", end_time: "08:50" }),
      eventRecord("next", "下一节安排", { start_time: "09:20", end_time: "10:05" })
    ], semester, [], [], vi.fn(), { onEditEvent });
    const group = screen.getByRole("group", { name: "8:30–8:50，2项安排" });
    const next = screen.getByText("下一节安排").closest(".mobile-week-time-group") as HTMLElement;
    expect(Number.parseFloat(group.style.height)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(group.style.top) + Number.parseFloat(group.style.height)).toBeLessThanOrEqual(Number.parseFloat(next.style.top));
    expect(container.querySelectorAll('.mobile-week-slot-row[data-start-minute="510"]')).toHaveLength(1);
    expect(container.querySelector('.mobile-week-slot-row[data-start-minute="510"]')).toHaveStyle("height: 48px");
    const cell = screen.getByLabelText("7月6日 08:30–09:15查看2项日程");
    fireEvent.click(cell);
    expect(screen.queryByRole("button", { name: "编辑事项：下一节安排" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：短事项一" }));
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：短事项二" }));
    expect(onEditEvent.mock.calls.map(([record]) => record.id)).toEqual(["first", "second"]);
  });

  it("手机同时保留七天内容且同一时刻跨天纵向对齐", () => {
    const onSelectedDayChange = vi.fn();
    const { container } = renderWeekCalendar(vi.fn(), [
      eventRecord("monday", "周一自习"),
      eventRecord("sunday", "周日自习", { start_date: "2026-07-12", end_date: "2026-07-12" })
    ], semester, periods, [], vi.fn(), { onSelectedDayChange });

    expect(container.querySelectorAll(".mobile-week-dates > button")).toHaveLength(7);
    const monday = screen.getByText("周一自习").closest(".mobile-week-time-group") as HTMLElement;
    const sunday = screen.getByText("周日自习").closest(".mobile-week-time-group") as HTMLElement;
    expect(monday.style.top).toBe(sunday.style.top);
    expect(monday).toHaveAttribute("data-start-minute", "510");
    expect(sunday.style.getPropertyValue("--day-index")).toBe("6");
    fireEvent.click(screen.getByRole("button", { name: "7月12日 星期日" }));
    expect(onSelectedDayChange).toHaveBeenCalledWith(6);
    expect(screen.getByText("周一自习")).toBeInTheDocument();
    expect(screen.getByText("周日自习")).toBeInTheDocument();
    expect(container.querySelector(".corner-header")).not.toBeInTheDocument();
  });

  it("全天事项独立成行，新增和完成保留对应日期", () => {
    const onAddEvent = vi.fn();
    const onToggleCompleted = vi.fn();
    const sunday = eventRecord("all-day-sunday", "周日全天", { all_day: true, start_date: "2026-07-12", end_date: "2026-07-12" });
    renderWeekCalendar(onAddEvent, [
      eventRecord("all-day-1", "全天一", { all_day: true }),
      eventRecord("all-day-2", "全天二", { all_day: true }),
      sunday
    ], semester, periods, [], onToggleCompleted);

    expect(screen.getByText("全天一").closest(".mobile-week-all-day")).toContainElement(screen.getByText("全天二"));
    fireEvent.click(screen.getByLabelText("7月12日新增全天事项"));
    expect(onAddEvent).toHaveBeenCalledWith("2026-07-12", "09:00", "10:00", true);
    fireEvent.click(screen.getByRole("button", { name: "将 周日全天 标记为已完成" }));
    expect(onToggleCompleted).toHaveBeenCalledWith(sunday, new Date(2026, 6, 12), true);
  });

  it("课程卡保留教室、编辑及本次停课入口", () => {
    const onEditCourse = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const course = { ...baseFields, id: "course-1", semester_id: semester.id, name: "自动控制原理", classroom: "C204", teacher: "王老师", color: "#6385a6", note: "" };
    renderWeekCalendar(vi.fn(), [], semester, periods, [], vi.fn(), {
      courses: [course],
      schedules: [{ ...baseFields, id: "schedule-1", course_id: course.id, weekday: 1, start_period: 1, end_period: 1, weeks: [1] }],
      onEditCourse
    });
    fireEvent.click(screen.getByLabelText("7月6日 08:30–09:15查看1项日程"));
    expect(screen.getByText(/C204/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停课：自动控制原理 2026-07-06" }));
    expect(confirm).toHaveBeenCalledWith("将 7月6日 的“自动控制原理”标记为停课？");
    confirm.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "编辑课程：自动控制原理" }));
    expect(onEditCourse).toHaveBeenCalledWith(course);
  });

  it("今天的日期表头保持高亮", () => {
    const dates = weekDates(new Date());
    const { container } = renderWeekCalendar(vi.fn(), [], semester, periods, [], vi.fn(), { dates });
    const current = container.querySelector('[aria-current="date"]');
    expect(current).toHaveClass("today");
    expect(current).toHaveAttribute("aria-current", "date");
    expect(container.querySelector(".week-grid")).not.toBeInTheDocument();
  });

  it("清晨深夜各只有一个48像素行，早晚短项至少44像素且不显示1项标记", () => {
    renderWeekCalendar(vi.fn(), [], semester, []);
    const early = screen.getByText("清晨").closest(".mobile-week-time-band") as HTMLElement;
    const late = screen.getByText("深夜").closest(".mobile-week-time-band") as HTMLElement;
    expect(Number.parseFloat(early.style.height)).toBe(48);
    expect(Number.parseFloat(late.style.height)).toBe(48);
    cleanup();

    renderWeekCalendar(vi.fn(), [
      eventRecord("early", "晨跑", { start_time: "07:00", end_time: "07:30" }),
      eventRecord("late", "夜间阅读", { start_time: "23:00", end_time: "23:30" })
    ], semester, []);
    expect(screen.getByLabelText("7月6日 00:00–08:30查看1项日程")).toBeInTheDocument();
    expect(screen.getByLabelText("7月6日 21:45–24:00查看1项日程")).toBeInTheDocument();
    expect(screen.getByLabelText("7月6日 00:00–08:30查看1项日程").querySelector(".mobile-week-slot-count"))
      .not.toBeInTheDocument();
    const earlyGroup = screen.getByText("晨跑").closest(".mobile-week-time-group") as HTMLElement;
    const lateGroup = screen.getByText("夜间阅读").closest(".mobile-week-time-group") as HTMLElement;
    for (const [group, cell] of [
      [earlyGroup, screen.getByLabelText("7月6日 00:00–08:30查看1项日程")],
      [lateGroup, screen.getByLabelText("7月6日 21:45–24:00查看1项日程")]
    ]) {
      const row = cell.closest(".mobile-week-slot-row") as HTMLElement;
      expect(Number.parseFloat(group.style.height)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(row.style.height)).toBe(48);
      expect(Number.parseFloat(group.style.top)).toBeGreaterThanOrEqual(Number.parseFloat(row.style.top));
      expect(Number.parseFloat(group.style.top) + Number.parseFloat(group.style.height)).toBeLessThanOrEqual(Number.parseFloat(row.style.top) + 48);
    }
  });

  it("时间标题直接位于对应时段行内，不额外插入标题行", () => {
    const { container } = renderWeekCalendar(vi.fn(), [], semester, []);
    for (const name of ["清晨", "午休", "晚间", "深夜"]) {
      const separator = screen.getByRole("separator", { name: new RegExp(`^${name} `) });
      expect(separator).toHaveClass("mobile-week-time-separator");
      expect(separator.querySelector("button")).not.toBeInTheDocument();
      const row = separator.closest(".mobile-week-slot-row") as HTMLElement;
      expect(row).toHaveStyle("height: 48px");
      expect(row.querySelectorAll("button")).toHaveLength(7);
    }
    expect(container.querySelectorAll(".mobile-week-time-separator")).toHaveLength(4);
  });

  it("按原节次和休息时段保留48像素新增格，清晨只一格且午夜默认可保存", () => {
    const onAddEvent = vi.fn();
    const { container } = renderWeekCalendar(onAddEvent, [], semester, []);
    const slots = [
      { day: 6, start: "08:30", end: "09:15" },
      { day: 12, start: "09:20", end: "10:05" },
      { day: 7, start: "12:00", end: "13:30" },
      { day: 8, start: "17:00", end: "18:30" },
      { day: 9, start: "00:00", end: "08:30" },
      { day: 10, start: "21:45", end: "24:00" }
    ];
    slots.forEach((slot) => {
      for (let day = 6; day <= 12; day += 1) {
        expect(screen.getByLabelText(`7月${day}日 ${slot.start}–${slot.end}新增事项`)).toBeInTheDocument();
      }
      const cell = screen.getByLabelText(`7月${slot.day}日 ${slot.start}–${slot.end}新增事项`);
      const band = cell.closest(".mobile-week-time-band") as HTMLElement;
      expect(Number.parseFloat(band.style.height)).toBe(48);
      fireEvent.click(cell);
      expect(onAddEvent).toHaveBeenLastCalledWith(`2026-07-${String(slot.day).padStart(2, "0")}`, slot.start, slot.end === "24:00" ? "23:59" : slot.end);
    });
    expect(onAddEvent).toHaveBeenCalledTimes(slots.length);
    expect(container.querySelectorAll('.mobile-week-slot-row[data-start-minute="0"][data-end-minute="510"]')).toHaveLength(1);
    expect(container.querySelectorAll(".mobile-week-slot-row")).toHaveLength(16);
    expect(screen.queryByText("每格30分钟")).not.toBeInTheDocument();
  });

  it("20:10配置精确保留，短续片保留44像素下限且不撑高所属行", () => {
    const oddPeriods: ClassPeriod[] = [periods[0], {
      ...periods[0], id: "period-evening", period_number: 10, name: "第十节", start_time: "19:30", end_time: "20:10"
    }];
    const { container } = renderWeekCalendar(vi.fn(), [
      eventRecord("odd-boundary", "晚间自习", { start_time: "19:55", end_time: "20:45" })
    ], semester, oddPeriods);
    const slots = [...container.querySelectorAll<HTMLElement>(".mobile-week-slot-row")];
    expect(slots).toHaveLength(5);
    expect(slots.every((slot) => Number.parseFloat(slot.style.height) === 48)).toBe(true);
    const before = container.querySelector<HTMLElement>('.mobile-week-slot-row[data-start-minute="1170"][data-end-minute="1210"]')!;
    const after = container.querySelector<HTMLElement>('.mobile-week-slot-row[data-start-minute="1210"][data-end-minute="1440"]')!;
    const separator = screen.getByRole("separator", { name: "深夜 20:10–24:00" });
    expect(Number.parseFloat(before.style.top) + 48).toBe(Number.parseFloat(after.style.top));
    expect(separator.closest(".mobile-week-slot-row")).toBe(after);
    const pieces = [...container.querySelectorAll<HTMLElement>(".mobile-week-time-group")];
    expect(pieces).toHaveLength(2);
    for (const [index, row] of [before, after].entries()) {
      const piece = pieces[index];
      expect(Number.parseFloat(piece.style.height)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(piece.style.top)).toBeGreaterThanOrEqual(Number.parseFloat(row.style.top));
      expect(Number.parseFloat(piece.style.top) + Number.parseFloat(piece.style.height)).toBeLessThanOrEqual(Number.parseFloat(row.style.top) + 48);
    }
  });

  it("恢复空白时间新增入口后，真实夜间事项仍能编辑和完成", () => {
    const onEditEvent = vi.fn();
    const onToggleCompleted = vi.fn();
    const event = eventRecord("late", "夜间阅读", { start_time: "23:00", end_time: "23:30" });
    renderWeekCalendar(vi.fn(), [event], semester, [], [], onToggleCompleted, { onEditEvent });
    expect(screen.getByLabelText("7月6日 18:30–19:15新增事项")).toBeInTheDocument();
    expect(screen.getByLabelText("7月6日 17:00–18:30新增事项")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("7月6日 21:45–24:00查看1项日程"));
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：夜间阅读" }));
    expect(onEditEvent).toHaveBeenCalledWith(event);
    fireEvent.click(screen.getByLabelText("7月6日 21:45–24:00查看1项日程"));
    fireEvent.click(screen.getByRole("button", { name: "将 夜间阅读 标记为已完成" }));
    expect(onToggleCompleted).toHaveBeenCalledWith(event, new Date(2026, 6, 6), true);
  });

  it("电脑仍保留没有安排的节次空白格", () => {
    mockMatchMedia(false);
    renderWeekCalendar(vi.fn(), [], semester, []);
    expect(screen.getByLabelText("7月6日 第九节新增事项")).toBeInTheDocument();
    expect(screen.getByLabelText("7月6日 第十节新增事项")).toBeInTheDocument();
  });

  it("跨午休事项按各原时段比例显示，格内仅提供一次完成操作", () => {
    const onEditEvent = vi.fn();
    const event = eventRecord("across-lunch", "跨午休安排", { start_time: "11:00", end_time: "14:00" });
    renderWeekCalendar(vi.fn(), [event], semester, [], [], vi.fn(), { onEditEvent });
    const first = screen.getByText("跨午休安排").closest(".mobile-week-time-group") as HTMLElement;
    const second = screen.getByText("续 · 跨午休安排").closest(".mobile-week-time-group") as HTMLElement;
    const separator = screen.getByRole("separator", { name: "午休 12:00–13:30" });
    const lunchRow = separator.closest(".mobile-week-slot-row") as HTMLElement;
    expect(Number.parseFloat(first.style.top) + Number.parseFloat(first.style.height)).toBeCloseTo(Number.parseFloat(lunchRow.style.top), 4);
    expect(Number.parseFloat(second.style.top)).toBe(Number.parseFloat(lunchRow.style.top));
    expect(screen.getByText("续 · 跨午休安排")).toBeInTheDocument();
    expect(Number.parseFloat(first.style.height) + Number.parseFloat(second.style.height)).toBeCloseTo(48 * (10 / 45 + 1 + 1 + 30 / 45), 4);
    fireEvent.click(screen.getByLabelText("7月6日 10:25–11:10查看1项日程"));
    expect(screen.getAllByRole("button", { name: "将 跨午休安排 标记为已完成" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：跨午休安排" }));
    fireEvent.click(screen.getByLabelText("7月6日 12:00–13:30查看1项日程"));
    fireEvent.click(screen.getByRole("button", { name: "编辑事项：跨午休安排" }));
    expect(onEditEvent.mock.calls.map(([record]) => record)).toEqual([event, event]);
  });

  it("普通多日日期范围每天沿用同一时段", () => {
    const { container } = renderWeekCalendar(vi.fn(), [
      eventRecord("range", "连续训练", { end_date: "2026-07-08", start_time: "10:00", end_time: "11:00" })
    ]);
    const groups = [...container.querySelectorAll<HTMLElement>(".mobile-week-time-group")];
    expect(groups).toHaveLength(3);
    expect(groups.every((group) => group.dataset.startMinute === "600" && group.dataset.endMinute === "660")).toBe(true);
    expect(groups.map((group) => group.style.top)).toEqual([groups[0].style.top, groups[0].style.top, groups[0].style.top]);
  });

  it("事项卡片可按当前显示日期切换完成状态", () => {
    const onAddEvent = vi.fn();
    const onToggleCompleted = vi.fn();
    const eventItem = eventRecord("event-location", "图书馆自习", { location: "图书馆二楼" });
    const state: EventOccurrenceState = {
      ...baseFields,
      id: "state-1",
      event_id: eventItem.id,
      occurrence_date: "2026-07-06",
      completed: true,
      reminder_sent_at: null
    };
    renderWeekCalendar(onAddEvent, [eventItem], semester, periods, [state], onToggleCompleted);

    const card = screen.getByText("图书馆自习").closest("article");

    expect(card).toHaveClass("completed");
    fireEvent.click(screen.getByLabelText("7月6日 08:30–09:15查看1项日程"));
    expect(screen.getByText(/图书馆二楼/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "将 图书馆自习 标记为未完成" }));
    expect(onToggleCompleted).toHaveBeenCalledWith(eventItem, new Date(2026, 6, 6), false);
  });

  it("没有学期时仍能显示普通事项并点击空白时间新增", () => {
    const onAddEvent = vi.fn();
    renderWeekCalendar(onAddEvent, [eventRecord("event-no-semester", "无学期事项")], null, []);

    expect(screen.getByText("无学期事项")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("7月7日 08:30–09:15新增事项"));

    expect(onAddEvent).toHaveBeenCalledWith("2026-07-07", "08:30", "09:15");
  });

  it("电脑端事项按节次内的真实分钟位置显示", () => {
    mockMatchMedia(false);
    const eventItem = eventRecord("event-minute-position", "分钟定位", {
      start_time: "08:45",
      end_time: "09:00"
    });
    renderWeekCalendar(vi.fn(), [eventItem]);

    const card = screen.getByText("分钟定位").closest("article") as HTMLElement;
    expect(Number.parseFloat(card.style.getPropertyValue("--time-start-offset"))).toBeCloseTo(25.33, 1);
    expect(Number.parseFloat(card.style.getPropertyValue("--time-end-offset"))).toBeCloseTo(25.33, 1);
  });

  it("显示第一节前的清晨事项和第十二节后的深夜事项", () => {
    renderWeekCalendar(vi.fn(), [
      eventRecord("event-early", "晨间准备", { start_time: "07:30", end_time: "08:00" }),
      eventRecord("event-late", "夜间复盘", { start_time: "22:30", end_time: "23:00" })
    ], semester, []);

    expect(screen.getByText("清晨")).toBeInTheDocument();
    expect(screen.getByText("00:00–08:30")).toBeInTheDocument();
    expect(screen.getByText("深夜")).toBeInTheDocument();
    expect(screen.getByText("21:45–24:00")).toBeInTheDocument();
    expect(screen.getByText("晨间准备")).toBeInTheDocument();
    expect(screen.getByText("夜间复盘")).toBeInTheDocument();
  });
});

function renderWeekCalendar(
  onAddEvent: (date: string, start: string, end: string, allDay?: boolean) => void,
  events: EventItem[] = [],
  activeSemester: Semester | null = semester,
  activePeriods: ClassPeriod[] = periods,
  occurrenceStates: EventOccurrenceState[] = [],
  onToggleEventCompleted: (event: EventItem, occurrenceDate: Date, completed: boolean) => void = vi.fn(),
  overrides: Partial<ComponentProps<typeof WeekCalendar>> = {}
) {
  return render(
    <WeekCalendar
      dates={weekDates(new Date(2026, 6, 6))}
      semester={activeSemester}
      courses={[]}
      schedules={[]}
      cancellations={[]}
      events={events}
      eventStatusFilter="all"
      categories={[]}
      occurrenceStates={occurrenceStates}
      periods={activePeriods}
      selectedDay={0}
      onSelectedDayChange={vi.fn()}
      onAddEvent={onAddEvent}
      onEditEvent={vi.fn()}
      onToggleEventCompleted={onToggleEventCompleted}
      onEditCourse={vi.fn()}
      {...overrides}
    />
  );
}

function eventRecord(id: string, title: string, overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...baseFields,
    id,
    event_type: "event",
    title,
    start_date: "2026-07-06",
    end_date: "2026-07-06",
    start_time: "08:30",
    end_time: "09:15",
    all_day: false,
    category_id: null,
    color: "#e36b32",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    recurrence_interval: 1,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}
