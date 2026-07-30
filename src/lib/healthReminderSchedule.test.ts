import { describe, expect, it } from "vitest";
import type { HealthProfile } from "../types";
import { dateAtProductTime, productDateTimeParts, toISODate } from "./date";
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
    last_movement_reminder_at: null,
    ...overrides
  };
}

describe("computeNextHealthReminder", () => {
  it("按最近活动或设置更新时间向后安排一个间隔", () => {
    const lastMovementAt = dateAtProductTime("2026-07-24", "09:15").toISOString();
    const result = computeNextHealthReminder(
      profile(),
      lastMovementAt,
      dateAtProductTime("2026-07-24", "09:20")
    );
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 10, minute: 15 });
    expect(result?.intervalMinutes).toBe(60);
  });

  it("候选时间越过结束时刻后移动到下一提醒窗口", () => {
    const updatedAt = dateAtProductTime("2026-07-24", "21:30").toISOString();
    const result = computeNextHealthReminder(
      profile({ updated_at: updatedAt }),
      null,
      dateAtProductTime("2026-07-24", "21:35")
    );
    expect(toISODate(result!.triggerAt)).toBe("2026-07-25");
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 9, minute: 0 });
  });

  it("关闭活动提醒时不生成原生计划", () => {
    expect(computeNextHealthReminder(profile({ movement_reminder_enabled: false }), null)).toBeNull();
  });

  it("按上次已发送活动提醒推迟下一次提醒，避免跨端短间隔重复", () => {
    const result = computeNextHealthReminder(
      profile({ last_movement_reminder_at: dateAtProductTime("2026-07-24", "10:05").toISOString() }),
      dateAtProductTime("2026-07-24", "09:15").toISOString(),
      dateAtProductTime("2026-07-24", "10:20")
    );
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 11, minute: 5 });
  });
});
