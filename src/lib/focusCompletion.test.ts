import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { activeFocusStorageKey, loadActiveFocus, saveActiveFocus, savePomodoroPlan, type ActiveFocusState } from "./focus";
import { completeFocusSession } from "./focusCompletion";

const startedAt = "2026-07-20T00:00:00.000Z";
const now = new Date("2026-07-20T00:01:00.000Z");
function active(mode: ActiveFocusState["mode"] = "pomodoro"): ActiveFocusState {
  return {
    mode, task_title: "任务", linked_event_id: null, planned_seconds: 60,
    started_at: startedAt, paused_seconds: 0, pause_started_at: null,
    pomodoro_plan_id: "plan-1", pomodoro_round: 1, pomodoro_total_rounds: 2,
    pomodoro_auto_start_break: true, pomodoro_short_break_seconds: 300,
    pomodoro_focus_seconds: 60, pomodoro_task_title: "任务"
  };
}
beforeEach(async () => {
  localStorage.clear();
  await Promise.all([db.focusSessions.clear(), db.restSessions.clear(), db.syncQueue.clear(), db.focusSettings.clear()]);
  savePomodoroPlan("alice", { id: "plan-1", task_title: "任务", linked_event_id: null, total_rounds: 2, next_round: 1, completed_rounds: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("跨标签专注结算", () => {
  it.each(["pomodoro", "rest"] as const)("两个独立模块和数据库连接并发完成 %s 仅保存一次且下一阶段一致", async (mode) => {
    vi.resetModules();
    const other = await import("./focusCompletion");
    const otherDb = (await import("../db")).db;
    expect(otherDb).not.toBe(db);
    const state = active(mode);
    saveActiveFocus("alice", state);
    try {
      const results = await Promise.all([
        completeFocusSession("alice", state, { completed: true, interrupted: false, now }),
        other.completeFocusSession("alice", state, { completed: true, interrupted: false, now: new Date(now.getTime() + 5000) })
      ]);
      expect(results.filter((result) => result?.created)).toHaveLength(1);
      const records = mode === "rest" ? await db.restSessions.toArray() : await db.focusSessions.toArray();
      expect(records).toHaveLength(1);
      expect(records[0].id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      expect(await db.syncQueue.count()).toBe(1);
      expect(loadActiveFocus("alice")).toMatchObject({
        mode: mode === "rest" ? "pomodoro" : "rest", started_at: records[0].ended_at,
        pomodoro_round: mode === "rest" ? 2 : 1
      });
      expect(results[0]?.nextActive).toEqual(results[1]?.nextActive);
    } finally { otherDb.close(); }
  });

  it("同一会话被不同mode调用时不写入两张记录表", async () => {
    saveActiveFocus("alice", active());
    await Promise.all([
      completeFocusSession("alice", active(), { completed: true, interrupted: false, now }),
      completeFocusSession("alice", active("rest"), { completed: true, interrupted: false, now })
    ]);
    expect(await db.focusSessions.count() + await db.restSessions.count()).toBe(1);
  });

  it("相同开始时间的不同账号互不合并，未完成的保存不推进番茄", async () => {
    saveActiveFocus("alice", active());
    saveActiveFocus("bob", active());
    const [alice, bob] = await Promise.all([
      completeFocusSession("alice", active(), { completed: false, interrupted: true, now }),
      completeFocusSession("bob", active(), { completed: true, interrupted: false, now })
    ]);
    expect(alice?.nextActive).toBeNull();
    expect(bob?.nextActive?.mode).toBe("rest");
    expect(await db.focusSessions.count()).toBe(2);
    expect(await db.syncQueue.count()).toBe(2);
  });

  it("过期结算不能覆盖另一个标签新启动的会话", async () => {
    const newer = { ...active(), started_at: new Date(now.getTime() + 1000).toISOString() };
    saveActiveFocus("alice", newer);
    expect(await completeFocusSession("alice", active(), { completed: true, interrupted: false, now })).toBeNull();
    expect(loadActiveFocus("alice")).toEqual(newer);
    expect(await db.focusSessions.count()).toBe(0);
  });

  it("同步队列写失败时记录回滚且活动状态保留供重试", async () => {
    saveActiveFocus("alice", active());
    const failure = vi.spyOn(db.syncQueue, "put").mockRejectedValueOnce(new Error("queue failed"));
    await expect(completeFocusSession("alice", active(), { completed: true, interrupted: false, now })).rejects.toThrow("queue failed");
    failure.mockRestore();
    expect(await db.focusSessions.count()).toBe(0);
    expect(loadActiveFocus("alice")?.started_at).toBe(startedAt);
    expect((await completeFocusSession("alice", active(), { completed: true, interrupted: false, now }))?.created).toBe(true);
  });

  it("数据库提交后状态发布失败可按首次结束时间恢复，不能重复插入或分叉", async () => {
    saveActiveFocus("alice", active());
    const original = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === activeFocusStorageKey("alice")) throw new Error("storage failed");
      return original.call(this, key, value);
    });
    await expect(completeFocusSession("alice", active(), { completed: true, interrupted: false, now })).rejects.toThrow("storage failed");
    failure.mockRestore();
    expect(await db.focusSessions.count()).toBe(1);
    const replay = await completeFocusSession("alice", active(), { completed: true, interrupted: false, now: new Date(now.getTime() + 9000) });
    expect(replay?.created).toBe(false);
    expect(loadActiveFocus("alice")).toMatchObject({ mode: "rest", started_at: now.toISOString() });
    expect(await db.focusSessions.count()).toBe(1);
    expect(await db.syncQueue.count()).toBe(1);
  });
});
