import { describe, expect, it } from "vitest";
import type { EventItem, EventOccurrenceState } from "../types";
import { buildHabitStats, eachHabitDate } from "./habits";

const baseFields = {
  id: "id",
  user_id: "local",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test-device"
};

describe("习惯统计", () => {
  it("按开始结束日期统计每日习惯完成率和连续天数", () => {
    const habit = habitRecord({
      start_date: "2026-07-01",
      end_date: "2026-07-08"
    });
    const states = ["2026-07-01", "2026-07-02", "2026-07-06", "2026-07-07", "2026-07-08"].map((date) => stateRecord(date));

    const stats = buildHabitStats(habit, states, new Date(2026, 6, 8, 12));

    expect(stats.totalScheduled).toBe(8);
    expect(stats.completed).toBe(5);
    expect(stats.completionRate).toBe(63);
    expect(stats.currentStreak).toBe(3);
    expect(stats.todayOccurs).toBe(true);
    expect(stats.todayCompleted).toBe(true);
  });

  it("只列出每周重复习惯实际发生的日期", () => {
    const habit = habitRecord({
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      recurrence_type: "weekly",
      recurrence_until: "2026-07-31"
    });

    expect(eachHabitDate(habit, new Date(2026, 6, 1), new Date(2026, 6, 15))).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15"
    ]);
  });
});

function habitRecord(overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...baseFields,
    id: "habit-1",
    event_type: "habit",
    title: "喝水",
    start_date: "2026-07-01",
    start_time: "09:00",
    end_date: "2026-07-08",
    end_time: "09:10",
    all_day: false,
    category_id: null,
    color: "#10b981",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    reminder_enabled: true,
    reminder_minutes_before: 0,
    timezone: "Asia/Shanghai",
    ...overrides,
    recurrence_interval: overrides.recurrence_interval ?? 1
  };
}

function stateRecord(date: string): EventOccurrenceState {
  return {
    ...baseFields,
    id: `state-${date}`,
    event_id: "habit-1",
    occurrence_date: date,
    completed: true,
    reminder_sent_at: null
  };
}
