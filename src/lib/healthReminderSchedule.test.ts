import { describe, expect, it } from "vitest";
import type { HealthProfile } from "../types";
import { dateAtProductTime, productDateTimeParts, toISODate } from "./date";
import { computeNextHealthReminder, dueHealthReminderSlot } from "./healthReminderSchedule";

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
  it("设置在 09:02 保存后仍对齐到下一个整点时间槽", () => {
    const result = computeNextHealthReminder(
      profile({ updated_at: dateAtProductTime("2026-07-24", "09:02").toISOString() }),
      dateAtProductTime("2026-07-24", "09:02")
    );
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 10, minute: 0 });
    expect(result?.intervalMinutes).toBe(60);
  });

  it("结束时刻之后移动到下一天的开始时间槽", () => {
    const result = computeNextHealthReminder(
      profile(),
      dateAtProductTime("2026-07-24", "22:01")
    );
    expect(toISODate(result!.triggerAt)).toBe("2026-07-25");
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 9, minute: 0 });
  });

  it("关闭活动提醒时不生成原生计划", () => {
    expect(computeNextHealthReminder(profile({ movement_reminder_enabled: false }))).toBeNull();
  });

  it("上次提醒晚到不会让后续时间槽跟着漂移", () => {
    const result = computeNextHealthReminder(
      profile({ last_movement_reminder_at: dateAtProductTime("2026-07-24", "10:05").toISOString() }),
      dateAtProductTime("2026-07-24", "10:20")
    );
    expect(productDateTimeParts(result!.triggerAt)).toMatchObject({ hour: 11, minute: 0 });
  });

  it("允许三分钟内补发当前时间槽，但不会在更晚时间随机补发", () => {
    const currentSlot = dueHealthReminderSlot(
      profile({ updated_at: dateAtProductTime("2026-07-24", "08:30").toISOString() }),
      null,
      dateAtProductTime("2026-07-24", "10:02")
    );
    expect(productDateTimeParts(currentSlot!)).toMatchObject({ hour: 10, minute: 0 });
    expect(dueHealthReminderSlot(
      profile({ updated_at: dateAtProductTime("2026-07-24", "08:30").toISOString() }),
      null,
      dateAtProductTime("2026-07-24", "10:04")
    )).toBeNull();
  });

  it("刚保存设置时不补发已经过去的时间槽", () => {
    expect(dueHealthReminderSlot(
      profile({ updated_at: dateAtProductTime("2026-07-24", "10:02").toISOString() }),
      null,
      dateAtProductTime("2026-07-24", "10:02")
    )).toBeNull();
  });

  it("旧的错误送达分钟不会阻止下一个固定时间槽", () => {
    const slot = dueHealthReminderSlot(
      profile({ updated_at: dateAtProductTime("2026-07-24", "08:30").toISOString() }),
      dateAtProductTime("2026-07-24", "10:17"),
      dateAtProductTime("2026-07-24", "11:00")
    );
    expect(productDateTimeParts(slot!)).toMatchObject({ hour: 11, minute: 0 });
  });
});
