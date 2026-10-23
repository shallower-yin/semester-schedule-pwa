import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import { elapsedFocusSeconds, focusDailyTotals, focusModeLabel, focusRecordsForPeriod, focusSessionsForDate, formatFocusDuration, formatFocusRecordTiming, remainingFocusSeconds, totalFocusSeconds } from "./focus";

describe("专注计时", () => {
  it("北京时间周一凌晨按上海周界限汇总，不混入上周和未来记录", () => {
    const now = new Date("2026-07-20T00:05:00+08:00");
    now.getDate = () => 19;
    now.getDay = () => 0;
    const records = [
      session("2026-07-19T23:59:59+08:00", 10),
      session("2026-07-20T00:00:00+08:00", 20),
      session("2026-07-20T00:06:00+08:00", 30)
    ];
    expect(focusRecordsForPeriod(records, "week", now).map((record) => record.duration_seconds)).toEqual([20]);
    expect(focusRecordsForPeriod(records, "day", now).map((record) => record.duration_seconds)).toEqual([20]);
  });
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

  it("以北京时间纯数字显示记录的日期、起止时间和持续时间", () => {
    expect(formatFocusRecordTiming(
      "2026-07-30T08:19:23.000Z",
      "2026-07-30T08:54:45.000Z",
      2122
    )).toBe("2026/07/30 · 16:19:23 → 16:54:45 · 35:22");
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

  it("设备日期落后北京时间时统计仍包含北京时间今天", () => {
    const now = new Date("2026-07-08T00:05:00+08:00");
    // A device in New York sees July 7 while the product day is already July 8.
    now.getFullYear = () => 2026;
    now.getMonth = () => 6;
    now.getDate = () => 7;
    const totals = focusDailyTotals([session("2026-07-08T00:01:00+08:00", 300)], 1, now);
    expect(totals).toEqual([{ date: "2026-07-08", label: "7/8", total_seconds: 300, session_count: 1 }]);
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
