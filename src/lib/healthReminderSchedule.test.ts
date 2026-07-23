import { describe, expect, it } from "vitest";
import type { HealthProfile } from "../types";
import { computeNextHealthReminder } from "./healthReminderSchedule";

function profile(overrides: Partial<HealthProfile> = {}): HealthProfile {
  return {
    id: "health-1",
    user_id: "local",
    created_at: "2026-07-24T00:00:00.000+08:00",
    updated_at: "2026-07-24T08:30:00.000+08:00",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    height_cm: null,
    daily_water_goal_ml: 2000,
    exercise_items: ["俯卧撑"],
    movement_reminder_enabled: true,
    movement_interval_minutes: 60,
    reminder_start_time: "09:00",
    reminder_end_time: "22:00",
    ...overrides
  };
}

describe("computeNextHealthReminder", () => {
  it("按最近活动或设置更新时间向后安排一个间隔", () => {
    const lastMovementAt = new Date(2026, 6, 24, 9, 15).toISOString();
    const result = computeNextHealthReminder(
      profile(),
      lastMovementAt,
      new Date(2026, 6, 24, 9, 20)
    );
    expect(result?.triggerAt.getHours()).toBe(10);
    expect(result?.triggerAt.getMinutes()).toBe(15);
    expect(result?.intervalMinutes).toBe(60);
  });

  it("候选时间越过结束时刻后移动到下一提醒窗口", () => {
    const updatedAt = new Date(2026, 6, 24, 21, 30).toISOString();
    const result = computeNextHealthReminder(
      profile({ updated_at: updatedAt }),
      null,
      new Date(2026, 6, 24, 21, 35)
    );
    expect(result?.triggerAt.getDate()).toBe(25);
    expect(result?.triggerAt.getHours()).toBe(9);
    expect(result?.triggerAt.getMinutes()).toBe(0);
  });

  it("关闭活动提醒时不生成原生计划", () => {
    expect(computeNextHealthReminder(profile({ movement_reminder_enabled: false }), null)).toBeNull();
  });
});
