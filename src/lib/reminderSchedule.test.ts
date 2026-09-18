import { describe, expect, it } from "vitest";
import type { Anniversary, EventItem, EventOccurrenceState, TodoItem } from "../types";
import { dateAtProductTime, productDateTimeParts } from "./date";
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

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "todo-1",
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    title: "交作业",
    color: "#ccecf7",
    sort_order: 100,
    is_pinned: false,
    completed_at: null,
    reminder_enabled: true,
    reminder_at: "2026-07-05T12:00:00.000Z",
    reminder_sent_at: null,
    ...overrides
  };
}

const NOW = dateAtProductTime("2026-07-05", "08:00");

describe("computeScheduledReminders", () => {
  it("为未来事项生成带确定性 id 的提醒", () => {
    const result = computeScheduledReminders({ events: [event()], anniversaries: [], occurrenceStates: [], now: NOW });
    expect(result).toHaveLength(1);
    const key = "event:event-1:2026-07-05";
    expect(result[0].key).toBe(key);
    expect(result[0].id).toBe(reminderNotificationId(key));
    expect(result[0].title).toBe("开会");
    expect(productDateTimeParts(result[0].at)).toMatchObject({ hour: 8, minute: 50 });
  });

  it("事项提醒正文包含时间和地点，地点为空时保持原格式", () => {
    expect(computeScheduledReminders({
      events: [event({ location: "图书馆二楼" })],
      anniversaries: [],
      occurrenceStates: [],
      now: NOW
    })[0].body).toBe("2026-07-05 09:00 开始 · 图书馆二楼");

    expect(computeScheduledReminders({
      events: [event({ location: "   " })],
      anniversaries: [],
      occurrenceStates: [],
      now: NOW
    })[0].body).toBe("2026-07-05 09:00 开始");

    expect(computeScheduledReminders({
      events: [event({ all_day: true, start_time: null, location: "线上" })],
      anniversaries: [],
      occurrenceStates: [],
      now: NOW
    })[0].body).toBe("2026-07-05 全天事项 · 线上");
  });

  it("跳过关闭提醒、已完成、已删除的事项", () => {
    expect(computeScheduledReminders({ events: [event({ reminder_enabled: false })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [event({ completed_at: "2026-07-05T00:00:00.000Z" })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [event({ deleted_at: "2026-07-05T00:00:00.000Z" })], anniversaries: [], occurrenceStates: [], now: NOW })).toHaveLength(0);
  });

  it("跳过已经过去的提醒时间", () => {
    const result = computeScheduledReminders({ events: [event()], anniversaries: [], occurrenceStates: [], now: dateAtProductTime("2026-07-05", "09:30") });
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
    expect(result[0].at.getTime()).toBe(dateAtProductTime("2026-07-05", "08:50").getTime());
  });

  it("为启用的纪念日生成提醒，跳过关闭的", () => {
    const scheduled = computeScheduledReminders({ events: [], anniversaries: [anniversary()], occurrenceStates: [], now: NOW });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].key).toBe("anniversary:anniversary-1:2026-07-10");
    expect(scheduled[0].title).toBe("生日");
    expect(productDateTimeParts(scheduled[0].at)).toMatchObject({ hour: 9, minute: 0 });

    expect(computeScheduledReminders({ events: [], anniversaries: [anniversary({ reminder_enabled: false })], occurrenceStates: [], now: NOW })).toHaveLength(0);
  });

  it("为未来待办生成一次性提醒，并跳过完成、删除、已发送或关闭提醒的待办", () => {
    const scheduled = computeScheduledReminders({
      events: [],
      anniversaries: [],
      occurrenceStates: [],
      todos: [todo()],
      now: NOW
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      key: "todo:todo-1",
      id: reminderNotificationId("todo:todo-1"),
      title: "交作业",
      body: "2026-07-05 20:00 待办提醒"
    });
    expect(productDateTimeParts(scheduled[0].at)).toMatchObject({ hour: 20, minute: 0 });

    expect(computeScheduledReminders({ events: [], anniversaries: [], occurrenceStates: [], todos: [todo({ completed_at: "2026-07-05T00:00:00.000Z" })], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [], anniversaries: [], occurrenceStates: [], todos: [todo({ deleted_at: "2026-07-05T00:00:00.000Z" })], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [], anniversaries: [], occurrenceStates: [], todos: [todo({ reminder_enabled: false })], now: NOW })).toHaveLength(0);
    expect(computeScheduledReminders({ events: [], anniversaries: [], occurrenceStates: [], todos: [todo({ reminder_sent_at: "2026-07-05T12:00:00.000Z" })], now: NOW })).toHaveLength(0);
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
