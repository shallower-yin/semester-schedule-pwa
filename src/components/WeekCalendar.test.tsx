import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { weekDates } from "../lib/date";
import type { ClassPeriod, Semester } from "../types";
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

  it("长按空白时间格快速新增，并抑制随后触发的普通点击", () => {
    const onAddEvent = vi.fn();
    renderWeekCalendar(onAddEvent);

    const cell = screen.getByLabelText("7月6日 第一节新增事项");
    fireEvent.pointerDown(cell, { pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(530);
    });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);

    expect(onAddEvent).toHaveBeenCalledTimes(1);
    expect(onAddEvent).toHaveBeenCalledWith("2026-07-06", "08:30", "09:15");
  });

  it("长按过程中取消触控不会新增事项", () => {
    const onAddEvent = vi.fn();
    renderWeekCalendar(onAddEvent);

    const cell = screen.getByLabelText("7月6日 第一节新增事项");
    fireEvent.pointerDown(cell, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(cell);
    act(() => {
      vi.advanceTimersByTime(530);
    });

    expect(onAddEvent).not.toHaveBeenCalled();
  });
});

function renderWeekCalendar(onAddEvent: ReturnType<typeof vi.fn>) {
  render(
    <WeekCalendar
      dates={weekDates(new Date(2026, 6, 6))}
      semester={semester}
      courses={[]}
      schedules={[]}
      cancellations={[]}
      events={[]}
      eventStatusFilter="all"
      categories={[]}
      occurrenceStates={[]}
      periods={periods}
      selectedDay={0}
      onSelectedDayChange={vi.fn()}
      onAddEvent={onAddEvent}
      onEditEvent={vi.fn()}
      onEditCourse={vi.fn()}
    />
  );
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
