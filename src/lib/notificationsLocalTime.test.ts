import { afterEach, expect, it, vi } from "vitest";
import { db } from "../db";
import type { EventItem } from "../types";
import { setCurrentUserId } from "./identity";
import { checkDueLocalReminders } from "./notifications";

vi.mock("./nativeApp", () => ({ isNativeApp: () => false }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("设备已进入次日时仍发送北京时间当晚到期提醒", async () => {
  vi.stubEnv("TZ", "Pacific/Auckland");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-07T23:50:00+08:00"));
  const showNotification = vi.fn(async () => {});
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ showNotification }) } });
  setCurrentUserId("local");
  await Promise.all([db.events.clear(), db.anniversaries.clear(), db.todos.clear(), db.eventOccurrenceStates.clear()]);
  await db.events.put({
    id: "late-event", user_id: "local", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    deleted_at: null, version: 1, device_id: "test", event_type: "event", title: "晚间事项",
    start_date: "2026-07-07", end_date: "2026-07-07", start_time: "23:50", end_time: "23:59",
    all_day: false, category_id: null, color: "#3157d5", note: "", recurrence_type: "none",
    recurrence_until: null, recurrence_interval: 1, reminder_enabled: true,
    reminder_minutes_before: 0, timezone: "Asia/Shanghai"
  } satisfies EventItem);

  expect(await checkDueLocalReminders("local")).toBe(1);
  expect(showNotification).toHaveBeenCalledWith("晚间事项", expect.objectContaining({ tag: "event-late-event-2026-07-07" }));
  expect(await checkDueLocalReminders("local")).toBe(0);
});
