import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleOverview } from "../lib/overview";
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

describe("今日页面下一项", () => {
  afterEach(() => {
    cleanup();
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
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
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
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
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
        events={[]}
        occurrenceStates={[]}
        onOpenItem={vi.fn()}
        onOpenFocus={vi.fn()}
      />
    );

    expect(screen.getAllByText("高数").length).toBeGreaterThan(0);
    expect(screen.queryByText("无事项，可以休息啦")).not.toBeInTheDocument();
  });
});
