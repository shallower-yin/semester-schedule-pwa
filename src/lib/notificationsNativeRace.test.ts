import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { EventItem, HealthProfile } from "../types";
import { setCurrentUserId } from "./identity";

const native = vi.hoisted(() => ({
  ensureNativeReminderPermission: vi.fn(async () => "granted"),
  syncNativeReminders: vi.fn(),
  syncNativeHealthReminder: vi.fn(async () => {}),
  ensureNativeReliableReminderService: vi.fn(async () => {}),
  getNativeReminderDiagnostics: vi.fn(async (): Promise<{
    events: Array<{ stage: string; id: number; at: number }>;
  } | null> => null)
}));

vi.mock("./nativeApp", () => ({ isNativeApp: () => true }));
vi.mock("./nativeReminders", () => ({
  cancelAllNativeReminders: vi.fn(),
  ensureNativeReliableReminderService: native.ensureNativeReliableReminderService,
  ensureNativeExactAlarmPermission: vi.fn(async () => true),
  ensureNativeReminderPermission: native.ensureNativeReminderPermission,
  getNativeReminderDiagnostics: native.getNativeReminderDiagnostics,
  getNativeReminderHealth: vi.fn(async () => null),
  showNativeNotificationNow: vi.fn(),
  stopNativeReliableReminderService: vi.fn(),
  syncNativeHealthReminder: native.syncNativeHealthReminder,
  syncNativeReminders: native.syncNativeReminders
}));
vi.mock("./reminderSchedule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reminderSchedule")>();
  return {
    ...actual,
    computeScheduledReminders: ({ events }: { events: EventItem[] }) => events.map((event, index) => ({
      key: event.user_id,
      id: index + 1,
      title: event.user_id,
      body: "",
      at: new Date("2026-09-01T08:00:00.000Z")
    }))
  };
});

import { refreshNativeReminderSchedule } from "./notifications";
import { HEALTH_NOTIFICATION_ID } from "./reminderSchedule";

describe("原生提醒账号切换串行化", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setCurrentUserId("alice");
    native.ensureNativeReminderPermission.mockResolvedValue("granted");
    native.syncNativeReminders.mockResolvedValue(1);
    native.syncNativeHealthReminder.mockResolvedValue(undefined);
    native.ensureNativeReliableReminderService.mockResolvedValue(undefined);
    native.getNativeReminderDiagnostics.mockResolvedValue(null);
    await Promise.all([
      db.events.clear(),
      db.anniversaries.clear(),
      db.eventOccurrenceStates.clear(),
      db.healthProfiles.clear()
    ]);
  });

  it("旧账号刷新完成后仍由最新账号覆盖最终系统计划", async () => {
    await db.events.bulkPut([
      { id: "alice-event", user_id: "alice", deleted_at: null } as EventItem,
      { id: "bob-event", user_id: "bob", deleted_at: null } as EventItem
    ]);
    let releaseAlice!: (value: number) => void;
    native.syncNativeReminders.mockImplementationOnce(() => new Promise<number>((resolve) => {
      releaseAlice = resolve;
    })).mockResolvedValue(1);

    const aliceRefresh = refreshNativeReminderSchedule("alice");
    await vi.waitFor(() => expect(native.syncNativeReminders).toHaveBeenCalledTimes(1));
    setCurrentUserId("bob");
    const bobRefresh = refreshNativeReminderSchedule("bob");
    releaseAlice(1);
    await Promise.all([aliceRefresh, bobRefresh]);

    expect(native.syncNativeReminders).toHaveBeenCalledTimes(2);
    expect(native.syncNativeReminders.mock.calls[0][0][0].title).toBe("alice");
    expect(native.syncNativeReminders.mock.calls[1][0][0].title).toBe("bob");
    expect(native.syncNativeHealthReminder).toHaveBeenCalledTimes(1);
    expect(native.syncNativeHealthReminder).toHaveBeenCalledWith({ enabled: false });

    await expect(refreshNativeReminderSchedule("alice")).resolves.toBe(0);
    expect(native.syncNativeReminders).toHaveBeenCalledTimes(2);
    expect(native.syncNativeReminders.mock.calls.at(-1)?.[0][0].title).toBe("bob");
  });

  it("旧刷新在健康冷却读取期间变旧后不再写资料或覆盖原生健康计划", async () => {
    const now = "2026-09-01T00:00:00.000Z";
    await db.healthProfiles.put({
      id: "alice-health",
      user_id: "alice",
      created_at: now,
      updated_at: now,
      deleted_at: null,
      version: 1,
      device_id: "test-device",
      height_cm: null,
      daily_water_goal_ml: 2000,
      exercise_items: [],
      movement_reminder_enabled: true,
      movement_interval_minutes: 60,
      reminder_start_time: "09:00",
      reminder_end_time: "22:00",
      last_movement_reminder_at: null
    } satisfies HealthProfile);

    let releaseDiagnostics!: (value: {
      events: Array<{ stage: string; id: number; at: number }>;
    }) => void;
    native.getNativeReminderDiagnostics.mockImplementationOnce(() => new Promise((resolve) => {
      releaseDiagnostics = resolve;
    }));

    const aliceRefresh = refreshNativeReminderSchedule("alice");
    await vi.waitFor(() => expect(native.getNativeReminderDiagnostics).toHaveBeenCalledTimes(1));
    setCurrentUserId("bob");
    const bobRefresh = refreshNativeReminderSchedule("bob");
    releaseDiagnostics({
      events: [{ stage: "notified", id: HEALTH_NOTIFICATION_ID, at: Date.parse(now) }]
    });
    await Promise.all([aliceRefresh, bobRefresh]);

    expect((await db.healthProfiles.get("alice-health"))?.last_movement_reminder_at).toBeNull();
    expect(await db.syncQueue.where("record_id").equals("alice-health").count()).toBe(0);
    expect(native.syncNativeHealthReminder).toHaveBeenCalledTimes(1);
    expect(native.syncNativeHealthReminder).toHaveBeenCalledWith({ enabled: false });
  });

  it("未登录时 local owner 仍可正常刷新原生计划", async () => {
    setCurrentUserId(null);
    await db.events.put({ id: "local-event", user_id: "local", deleted_at: null } as EventItem);

    await expect(refreshNativeReminderSchedule("local")).resolves.toBe(1);

    expect(native.syncNativeReminders).toHaveBeenCalledTimes(1);
    expect(native.syncNativeReminders.mock.calls[0][0][0].title).toBe("local");
    expect(native.syncNativeHealthReminder).toHaveBeenCalledWith({ enabled: false });
  });
});
