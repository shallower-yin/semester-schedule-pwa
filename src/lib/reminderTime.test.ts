import { describe, expect, it } from "vitest";
import type { EventItem } from "../types";
import { dateAtProductTime, parseLocalDate, productDateTimeParts } from "./date";
import { reminderIsDue, reminderTimeForOccurrence } from "./reminderTime";

function event(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: "event",
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    event_type: "event",
    title: "测试提醒",
    start_date: "2026-07-05",
    start_time: "09:00",
    end_date: "2026-07-05",
    end_time: "10:00",
    all_day: false,
    category_id: null,
    color: "#000000",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    reminder_enabled: true,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    ...overrides,
    recurrence_interval: overrides.recurrence_interval ?? 1
  };
}

describe("事项提醒时间", () => {
  it("按提前分钟数计算", () => {
    const result = reminderTimeForOccurrence(event(), parseLocalDate("2026-07-05"));
    expect(productDateTimeParts(result)).toMatchObject({ hour: 8, minute: 50 });
  });

  it("全天事项以当天 09:00 为基准", () => {
    const result = reminderTimeForOccurrence(
      event({ all_day: true, start_time: null, end_time: null, reminder_minutes_before: 60 }),
      parseLocalDate("2026-07-05")
    );
    expect(productDateTimeParts(result)).toMatchObject({ hour: 8, minute: 0 });
  });

  it("只在到期后的十五分钟补发窗口内触发", () => {
    const item = event();
    const date = parseLocalDate("2026-07-05");
    expect(reminderIsDue(item, date, dateAtProductTime("2026-07-05", "08:49"))).toBe(false);
    expect(reminderIsDue(item, date, dateAtProductTime("2026-07-05", "08:50"))).toBe(true);
    expect(reminderIsDue(item, date, dateAtProductTime("2026-07-05", "09:05"))).toBe(true);
    expect(reminderIsDue(item, date, dateAtProductTime("2026-07-05", "09:06"))).toBe(false);
  });
});
