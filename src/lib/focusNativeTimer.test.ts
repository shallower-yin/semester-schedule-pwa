import { beforeEach, describe, expect, it, vi } from "vitest";

const nativePlugin = vi.hoisted(() => ({
  start: vi.fn(),
  getState: vi.fn(),
  getTransitions: vi.fn(),
  clearTransitions: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  enterLockTask: vi.fn(),
  exitLockTask: vi.fn()
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => nativePlugin
}));

vi.mock("./nativeApp", () => ({
  isNativeApp: () => true
}));

import {
  clearNativeFocusTransitions,
  readNativeFocusTransitions,
  startNativeFocusTimer
} from "./focusNativeTimer";

describe("原生番茄计时桥", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativePlugin.start.mockResolvedValue({ elapsedSeconds: 0 });
    nativePlugin.getTransitions.mockResolvedValue({ transitions: [] });
    nativePlugin.clearTransitions.mockResolvedValue(undefined);
  });

  it("把完整番茄循环配置传给 Android 服务", async () => {
    await startNativeFocusTimer("user-1", {
      mode: "pomodoro",
      task_title: "复习液压",
      linked_event_id: "event-1",
      planned_seconds: 1500,
      started_at: new Date().toISOString(),
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_plan_id: "plan-1",
      pomodoro_round: 2,
      pomodoro_total_rounds: 4,
      pomodoro_short_break_seconds: 300,
      pomodoro_long_break_seconds: 900,
      pomodoro_long_break_interval: 4,
      pomodoro_auto_start_break: true,
      pomodoro_rest_kind: null,
      sound_enabled: true
    });

    expect(nativePlugin.start).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "user-1",
      linkedEventId: "event-1",
      pomodoroPlanId: "plan-1",
      pomodoroRound: 2,
      pomodoroTotalRounds: 4,
      pomodoroShortBreakSeconds: 300,
      pomodoroLongBreakSeconds: 900,
      pomodoroLongBreakInterval: 4,
      pomodoroAutoStartBreak: true,
      soundEnabled: true
    }));
  });

  it("阶段记录在持久化后可单独确认清除", async () => {
    nativePlugin.getTransitions.mockResolvedValue({
      transitions: [{ id: "transition-1", kind: "focus" }]
    });
    expect(await readNativeFocusTransitions()).toEqual([{ id: "transition-1", kind: "focus" }]);
    await clearNativeFocusTransitions(["transition-1"]);
    expect(nativePlugin.clearTransitions).toHaveBeenCalledWith({ ids: ["transition-1"] });
  });
});
