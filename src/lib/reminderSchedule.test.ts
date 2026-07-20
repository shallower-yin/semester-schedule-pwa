import { describe, expect, it } from "vitest";
import type { Anniversary, EventItem, EventOccurrenceState } from "../types";
import {
  computeScheduledReminders,
  MAX_SCHEDULED_REMINDERS,
  reminderNotificationId
} from "./reminderSchedule";

function event(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: "event-1",
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    event_type: "event",
    title: "开会",
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

function anniversary(overrides: Partial<Anniversary> = {}): Anniversary {
  return {
    id: "anniversary-1",
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    kind: "birthday",
    title: "生日",
    date: "2000-07-10",
    color: "#d97706",
    note: "",
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}

function occurrenceState(overrides: Partial<EventOccurrenceState>): EventOccurrenceState {
  return {
    id: "occ-1",
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    event_id: "event-1",
    occurrence_date: "2026-07-05",
    completed: false,
    reminder_sent_at: null,
    ...overrides
  };
}

const NOW = new Date(2026, 6, 5, 8, 0, 0);

describe("computeScheduledReminders", () => {
  it("为未来事项生成带确定性 id 的提醒", () => {
    const result = computeScheduledReminders({ events: [event()], anniversaries: [], occurrenceStates: [], now: NOW });
    expect(result).toHaveLength(1);
    const key = "event:event-1:2026-07-05";
    expect(result[0].key).toBe(key);
    expect(result[0].id).toBe(reminderNotificationId(key));
    expect(result[0].title).toBe("开会");
    expect(result[0].at.getHours()).toBe(8);
    expect(result[0].at.getMinutes()).toBe(50);
  });

  it("跳过关闭提醒、已完成、已删除的事项", () => {
    expect(computeScheduledReminders({ events: [event({ reminder_enabled: false })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [event({ completed_at: "2026-07-05T00:00:00.000Z" })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [event({ deleted_at: "2026-07-05T00:00:00.000Z" })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
  });

  it("跳过已经过去的提醒时间", () => {
    const result = computeScheduledReminders({ events: [event()], anniversaries: [], occurrenceStates: [], now: new Date(2026, 6, 5, 9, 30) });
    expect(result).toHaveLength(0);
  });

  it("跳过循环事项中已打卡的那一天", () => {
    const daily = event({ recurrence_type: "daily" });
    const result = computeScheduledReminders({
      events: [daily],
      anniversaries: [],
      occurrenceStates: [occurrenceState({ occurrence_date: "2026-07-06", completed: true })],
      now: NOW
    });
    const keys = result.map((reminder) => reminder.key);
    expect(keys).toContain("event:event-1:2026-07-05");
    expect(keys).not.toContain("event:event-1:2026-07-06");
    expect(keys).toContain("event:event-1:2026-07-07");
  });

  it("按上限截断并保留最早的提醒（升序）", () => {
    const daily1 = event({ id: "e1", recurrence_type: "daily" });
    const daily2 = event({ id: "e2", recurrence_type: "daily" });
    const result = computeScheduledReminders({ events: [daily1, daily2], anniversaries: [], occurrenceStates: [], now: NOW });
    expect(result).toHaveLength(MAX_SCHEDULED_REMINDERS);
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index].at.getTime()).toBeGreaterThanOrEqual(result[index - 1].at.getTime());
    }
    expect(result[0].at.getTime()).toBe(new Date(2026, 6, 5, 8, 50).getTime());
  });

  it("为启用的纪念日生成提醒，跳过关闭的", () => {
    const scheduled = computeScheduledReminders({ events: [], anniversaries: [anniversary()], occurrenceStates: [], now: NOW });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].key).toBe("anniversary:anniversary-1:2026-07-10");
    expect(scheduled[0].title).toBe("生日");
    expect(scheduled[0].at.getHours()).toBe(9);

    expect(computeScheduledReminders({ events: [], anniversaries: [anniversary({ reminder_enabled: false })], occurrenceStates: [], now: NOW })).toHaveLength(0);
  });
});

describe("reminderNotificationId", () => {
  it("确定、稳定、为保留区间以下的正整数", () => {
    expect(reminderNotificationId("event:x:2026-07-05")).toBe(reminderNotificationId("event:x:2026-07-05"));
    expect(reminderNotificationId("a")).not.toBe(reminderNotificationId("b"));
    const id = reminderNotificationId("event:x:2026-07-05");
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(2_147_483_645);
  });
});
