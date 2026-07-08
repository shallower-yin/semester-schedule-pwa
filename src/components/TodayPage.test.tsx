import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleOverview } from "../lib/overview";
import type { Anniversary } from "../types";
import { TodayPage } from "./TodayPage";

const baseOverview: ScheduleOverview = {
  todayDate: "2026-07-08",
  todayItemCount: 1,
  todayCourseCount: 0,
  todayEventCount: 1,
  todayIncompleteEventCount: 0,
  todayCompletedEventCount: 1,
  weekEventCount: 1,
  weekCompletedEventCount: 1,
  weekCompletionRate: 100,
  todayFocusSeconds: 0,
  weekFocusSeconds: 0,
  upcomingItems: [],
  overdueIncompleteItems: [],
  weekFocusTrend: []
};

const baseAnniversary: Anniversary = {
  id: "anniversary-1",
  user_id: "user-1",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test",
  kind: "birthday",
  title: "妈妈生日",
  date: "2026-07-10",
  color: "#db2777",
  note: "",
  reminder_enabled: false,
  reminder_days_before: 0,
  reminder_time: "09:00",
  reminder_sent_for: null,
  timezone: "Asia/Shanghai"
};

describe("今日页面下一项", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("当天事项都完成后显示休息提示", () => {
    render(
      <TodayPage
        overview={{
          ...baseOverview,
          upcomingItems: [{
            id: "event-1",
            type: "event",
            targetId: "event-1",
            title: "已完成事项",
            subtitle: "未分类事项",
            timeLabel: "09:00–09:00",
            sortTime: "09:00",
            color: "#3157d5",
            completed: true,
            occurrenceDate: "2026-07-08"
          }]
        }}
        anniversaries={[]}
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
        onAddEvent={vi.fn()}
      />
    );

    expect(screen.getByText("无事项，可以休息啦")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /处理/ })).not.toBeInTheDocument();
  });

  it("存在未完成事项时显示接下来要处理的事项", () => {
    render(
      <TodayPage
        overview={{
          ...baseOverview,
          todayIncompleteEventCount: 1,
          todayCompletedEventCount: 0,
          upcomingItems: [{
            id: "event-2",
            type: "event",
            targetId: "event-2",
            title: "未完成事项",
            subtitle: "未分类事项",
            timeLabel: "10:00–10:30",
            sortTime: "10:00",
            color: "#e36b32",
            completed: false,
            occurrenceDate: "2026-07-08"
          }]
        }}
        anniversaries={[]}
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
        onAddEvent={vi.fn()}
      />
    );

    expect(screen.getAllByText("未完成事项").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /处理/ })).toBeInTheDocument();
  });

  it("跳过已完成事项后仍可显示后续课程", () => {
    render(
      <TodayPage
        overview={{
          ...baseOverview,
          todayItemCount: 2,
          todayCourseCount: 1,
          todayCompletedEventCount: 1,
          upcomingItems: [
            {
              id: "event-1",
              type: "event",
              targetId: "event-1",
              title: "已完成事项",
              subtitle: "未分类事项",
              timeLabel: "09:00–09:00",
              sortTime: "09:00",
              color: "#3157d5",
              completed: true,
              occurrenceDate: "2026-07-08"
            },
            {
              id: "course-1",
              type: "course",
              targetId: "course-1",
              title: "高数",
              subtitle: "A101",
              timeLabel: "10:00–11:40",
              sortTime: "10:00",
              color: "#4f8dd3",
              completed: false
            }
          ]
        }}
        anniversaries={[]}
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
        onAddEvent={vi.fn()}
      />
    );

    expect(screen.getAllByText("高数").length).toBeGreaterThan(0);
    expect(screen.queryByText("无事项，可以休息啦")).not.toBeInTheDocument();
  });

  it("在顶部显示近十天的日子提醒", () => {
    render(
      <TodayPage
        overview={{
          ...baseOverview,
          todayDate: "2026-07-09"
        }}
        anniversaries={[
          baseAnniversary,
          {
            ...baseAnniversary,
            id: "anniversary-far",
            kind: "holiday",
            title: "远期节日",
            date: "2026-07-25",
            color: "#059669"
          }
        ]}
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenAnniversary={vi.fn()}
        onOpenFocus={vi.fn()}
        onAddEvent={vi.fn()}
      />
    );

    const reminders = screen.getByLabelText("近十天日子提醒");
    expect(within(reminders).getByText("妈妈生日")).toBeInTheDocument();
    expect(within(reminders).getByText("1")).toBeInTheDocument();
    expect(within(reminders).queryByText("远期节日")).not.toBeInTheDocument();
  });

  it("移动端长按今天页空白区域时带入今天日期和当前时间新增事项", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 9, 10));
    const onAddEvent = vi.fn();

    render(
      <TodayPage
        overview={baseOverview}
        anniversaries={[]}
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
        onAddEvent={onAddEvent}
      />
    );

    const page = document.querySelector(".today-page") as HTMLElement;
    fireEvent.pointerDown(page, { pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(530);
    });
    fireEvent.pointerUp(page);

    expect(onAddEvent).toHaveBeenCalledWith("2026-07-08", "09:30", "10:00");
  });
});

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
