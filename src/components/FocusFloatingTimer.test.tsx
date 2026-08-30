import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { loadActiveFocus, saveActiveFocus, savePomodoroPlan, type ActiveFocusState } from "../lib/focus";
import { setCurrentUserId } from "../lib/identity";
import { completeExpiredFocus } from "./FocusFloatingTimer";

describe("全局专注倒计时", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.focusSessions.clear();
    await db.restSessions.clear();
    await db.focusSettings.clear();
    await db.syncQueue.clear();
  });

  it("离开专注页后仍能在到点时结算并清除计时器", async () => {
    const active: ActiveFocusState = {
      mode: "countdown",
      task_title: "复习高数",
      linked_event_id: null,
      planned_seconds: 60,
      started_at: "2026-07-15T08:00:00.000Z",
      paused_seconds: 0,
      pause_started_at: null
    };
    saveActiveFocus("local", active);

    expect(await completeExpiredFocus("local", active, new Date("2026-07-15T08:01:05.000Z"))).toBe(true);
    expect(loadActiveFocus("local")).toBeNull();
    expect(await db.focusSessions.count()).toBe(1);
    expect(await db.syncQueue.where("table_name").equals("focusSessions").count()).toBe(1);
  });

  it("跨标签切换共享身份后，到点专注仍归属计时器的账号", async () => {
    const active: ActiveFocusState = {
      mode: "countdown",
      task_title: "Alice 的专注",
      linked_event_id: null,
      planned_seconds: 60,
      started_at: "2026-07-15T08:00:00.000Z",
      paused_seconds: 0,
      pause_started_at: null
    };
    saveActiveFocus("alice", active);
    setCurrentUserId("bob");

    expect(await completeExpiredFocus("alice", active, new Date("2026-07-15T08:01:05.000Z"))).toBe(true);
    expect((await db.focusSessions.toArray())[0]?.user_id).toBe("alice");
  });

  it("休息到点只写入休息记录，不写入专注记录", async () => {
    const active: ActiveFocusState = {
      mode: "rest",
      task_title: "休息",
      linked_event_id: null,
      planned_seconds: 300,
      started_at: "2026-07-15T08:00:00.000Z",
      paused_seconds: 0,
      pause_started_at: null
    };
    saveActiveFocus("local", active);

    expect(await completeExpiredFocus("local", active, new Date("2026-07-15T08:05:05.000Z"))).toBe(true);
    expect(await db.focusSessions.count()).toBe(0);
    expect(await db.restSessions.count()).toBe(1);
    expect((await db.restSessions.toArray())[0]).toMatchObject({ rest_kind: "manual" });
    expect(await db.syncQueue.where("table_name").equals("restSessions").count()).toBe(1);
  });

  it("番茄专注到点后在全局计时器中自动进入短休息", async () => {
    savePomodoroPlan("local", {
      id: "plan-1",
      task_title: "复习机电",
      linked_event_id: null,
      total_rounds: 4,
      next_round: 1,
      completed_rounds: 0
    });
    const active: ActiveFocusState = {
      mode: "pomodoro",
      task_title: "复习机电",
      linked_event_id: null,
      planned_seconds: 60,
      started_at: "2026-07-15T08:00:00.000Z",
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_plan_id: "plan-1",
      pomodoro_round: 1,
      pomodoro_total_rounds: 4,
      pomodoro_short_break_seconds: 300,
      pomodoro_long_break_seconds: 900,
      pomodoro_long_break_interval: 4,
      pomodoro_auto_start_break: true,
      pomodoro_focus_seconds: 60,
      pomodoro_task_title: "复习机电"
    };
    saveActiveFocus("local", active);

    expect(await completeExpiredFocus("local", active, new Date("2026-07-15T08:01:05.000Z"))).toBe(true);
    expect(await db.focusSessions.count()).toBe(1);
    expect(await db.restSessions.count()).toBe(0);
    expect(loadActiveFocus("local")).toMatchObject({
      mode: "rest",
      task_title: "短休息",
      planned_seconds: 300,
      pomodoro_round: 1,
      pomodoro_rest_kind: "pomodoro_short"
    });
  });

  it("番茄休息到点后在全局计时器中自动进入下一轮专注", async () => {
    savePomodoroPlan("local", {
      id: "plan-1",
      task_title: "复习机电",
      linked_event_id: null,
      total_rounds: 4,
      next_round: 2,
      completed_rounds: 1
    });
    const active: ActiveFocusState = {
      mode: "rest",
      task_title: "短休息",
      linked_event_id: null,
      planned_seconds: 300,
      started_at: "2026-07-15T08:01:05.000Z",
      paused_seconds: 0,
      pause_started_at: null,
      pomodoro_plan_id: "plan-1",
      pomodoro_round: 1,
      pomodoro_total_rounds: 4,
      pomodoro_short_break_seconds: 300,
      pomodoro_long_break_seconds: 900,
      pomodoro_long_break_interval: 4,
      pomodoro_auto_start_break: true,
      pomodoro_rest_kind: "pomodoro_short",
      pomodoro_focus_seconds: 60,
      pomodoro_task_title: "复习机电"
    };
    saveActiveFocus("local", active);

    expect(await completeExpiredFocus("local", active, new Date("2026-07-15T08:06:10.000Z"))).toBe(true);
    expect(await db.focusSessions.count()).toBe(0);
    expect(await db.restSessions.count()).toBe(1);
    expect(loadActiveFocus("local")).toMatchObject({
      mode: "pomodoro",
      task_title: "复习机电",
      planned_seconds: 60,
      pomodoro_round: 2,
      pomodoro_rest_kind: null
    });
  });
});
