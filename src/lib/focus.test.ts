import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import { elapsedFocusSeconds, focusDailyTotals, focusModeLabel, focusSessionsForDate, formatFocusDuration, remainingFocusSeconds, totalFocusSeconds } from "./focus";

describe("专注计时", () => {
  it("计算已用时间时扣除暂停时间", () => {
    const active = {
      mode: "countdown" as const,
      task_title: "复习",
      linked_event_id: null,
      planned_seconds: 1800,
      started_at: "2026-07-07T08:00:00.000Z",
      paused_seconds: 120,
      pause_started_at: "2026-07-07T08:10:00.000Z"
    };

    expect(elapsedFocusSeconds(active, new Date("2026-07-07T08:15:00.000Z"))).toBe(480);
    expect(remainingFocusSeconds(active, new Date("2026-07-07T08:15:00.000Z"))).toBe(1320);
  });

  it("格式化专注时长", () => {
    expect(formatFocusDuration(65)).toBe("01:05");
    expect(formatFocusDuration(3661)).toBe("01:01:01");
  });

  it("支持锁机模式标签", () => {
    expect(focusModeLabel("lock")).toBe("锁机");
  });

  it("按本地日期统计专注记录", () => {
    const sessions = [
      session("2026-07-07T02:00:00.000Z", 600),
      session("2026-07-08T02:00:00.000Z", 120)
    ];
    const matched = focusSessionsForDate(sessions, new Date(2026, 6, 7));

    expect(totalFocusSeconds(matched)).toBe(600);
  });

  it("生成近几日专注统计", () => {
    const totals = focusDailyTotals([
      session("2026-07-06T10:00:00.000Z", 300),
      session("2026-07-07T10:00:00.000Z", 600)
    ], 3, new Date("2026-07-07T12:00:00.000Z"));

    expect(totals.map((item) => ({ date: item.date, total: item.total_seconds, count: item.session_count }))).toEqual([
      { date: "2026-07-05", total: 0, count: 0 },
      { date: "2026-07-06", total: 300, count: 1 },
      { date: "2026-07-07", total: 600, count: 1 }
    ]);
  });
});

function session(endedAt: string, duration: number): FocusSession {
  return {
    id: crypto.randomUUID(),
    user_id: "local",
    created_at: endedAt,
    updated_at: endedAt,
    deleted_at: null,
    version: 1,
    device_id: crypto.randomUUID(),
    mode: "pomodoro",
    task_title: "任务",
    linked_event_id: null,
    planned_seconds: 1500,
    duration_seconds: duration,
    started_at: endedAt,
    ended_at: endedAt,
    completed: true,
    interrupted: false
  };
}
