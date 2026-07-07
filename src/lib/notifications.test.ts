import { afterEach, describe, expect, it, vi } from "vitest";
import { reminderScheduleChanged, withTimeout } from "./notifications";
import type { EventItem } from "../types";

describe("通知异步超时", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常操作直接返回结果", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "不应超时")).resolves.toBe("ok");
  });

  it("系统推送无响应时返回明确错误而不是永久等待", async () => {
    vi.useFakeTimers();
    const result = expect(
      withTimeout(new Promise<never>(() => undefined), 100, "连接手机系统推送服务超时")
    ).rejects.toThrow("连接手机系统推送服务超时");
    await vi.advanceTimersByTimeAsync(100);
    await result;
  });
});

describe("编辑事项后的再次提醒", () => {
  const event = {
    id: "event-1",
    user_id: "user-1",
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    event_type: "event",
    title: "测试",
    start_date: "2026-07-06",
    start_time: "12:18",
    end_date: "2026-07-06",
    end_time: "12:30",
    all_day: false,
    category_id: null,
    color: "#3157d5",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    reminder_enabled: true,
    reminder_minutes_before: 0,
    timezone: "Asia/Shanghai"
  } satisfies EventItem;

  it("修改开始时间后允许同一事项再次提醒", () => {
    expect(reminderScheduleChanged(event, { ...event, start_time: "12:48" })).toBe(true);
  });

  it("只修改标题或备注时不重复提醒", () => {
    expect(reminderScheduleChanged(event, { ...event, title: "新标题", note: "新备注" })).toBe(false);
  });
});
