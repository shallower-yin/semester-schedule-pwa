import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { EventItem, TodoItem } from "../types";
import { setCurrentUserId, syncFields } from "./identity";
import type { ScheduleWidgetCompletionAction, ScheduleWidgetPlugin } from "./scheduleWidgetPlugin";
import { consumePendingWidgetCompletionActions } from "./widgetCompletionActions";

type CompletionBridge = Pick<ScheduleWidgetPlugin, "getPendingCompletionActions" | "ackCompletionActions">;

describe("Android 小组件完成动作", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("alice");
    await db.transaction("rw", db.todos, db.events, db.eventOccurrenceStates, db.syncQueue, async () => {
      await db.todos.clear();
      await db.events.clear();
      await db.eventOccurrenceStates.clear();
      await db.syncQueue.clear();
    });
  });

  it("完成独立待办后写入同步队列，再确认原生动作", async () => {
    await db.todos.add(todoRecord());
    const bridge = completionBridge([action({ kind: "todo", targetId: "todo-1" })]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 1, applied: 1, acknowledged: 1 });
    expect((await db.todos.get("todo-1"))?.completed_at).toBeTruthy();
    expect(await db.syncQueue.where("record_id").equals("todo-1").first()).toMatchObject({
      owner_id: "alice",
      table_name: "todos",
      operation: "upsert"
    });
    expect(bridge.ackCompletionActions).toHaveBeenCalledWith({
      ownerId: "alice",
      actionIds: ["a".repeat(64)]
    });
  });

  it("按日期完成重复事项而不完成整项", async () => {
    await db.events.add(eventRecord());
    const bridge = completionBridge([action({
      actionId: "b".repeat(64),
      kind: "event",
      targetId: "event-1",
      occurrenceDate: "2026-09-03"
    })]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 1, applied: 1, acknowledged: 1 });
    const state = await db.eventOccurrenceStates
      .where("[event_id+occurrence_date]")
      .equals(["event-1", "2026-09-03"])
      .first();
    expect(state).toMatchObject({ user_id: "alice", completed: true });
    expect((await db.events.get("event-1"))?.completed_at).toBeNull();
    expect(await db.syncQueue.where("record_id").equals(state!.id).first()).toMatchObject({
      owner_id: "alice",
      table_name: "eventOccurrenceStates"
    });
  });

  it("记录已不存在或已经完成时安全确认且不会重复写队列", async () => {
    await db.todos.add({ ...todoRecord(), completed_at: new Date().toISOString() });
    const bridge = completionBridge([
      action({ kind: "todo", targetId: "todo-1" }),
      action({ actionId: "c".repeat(64), kind: "todo", targetId: "missing" })
    ]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 2, applied: 0, acknowledged: 2 });
    expect(await db.syncQueue.count()).toBe(0);
    expect(bridge.ackCompletionActions).toHaveBeenCalledWith({
      ownerId: "alice",
      actionIds: ["a".repeat(64), "c".repeat(64)]
    });
  });

  it("Dexie 或同步队列写入失败时保留原生动作供下次重试", async () => {
    await db.todos.add(todoRecord());
    const bridge = completionBridge([action({ kind: "todo", targetId: "todo-1" })]);
    const failQueueWrite = () => {
      throw new Error("模拟同步队列写入失败");
    };
    db.syncQueue.hook("creating", failQueueWrite);

    try {
      const result = await consumePendingWidgetCompletionActions("alice", bridge);
      expect(result).toEqual({ received: 1, applied: 0, acknowledged: 0 });
      expect((await db.todos.get("todo-1"))?.completed_at).toBeNull();
      expect(bridge.ackCompletionActions).not.toHaveBeenCalled();
    } finally {
      db.syncQueue.hook("creating").unsubscribe(failQueueWrite);
    }
  });

  it("其他账号的同 ID 记录不会被修改，但动作仍可安全丢弃", async () => {
    await db.todos.add({ ...todoRecord(), user_id: "bob" });
    const bridge = completionBridge([action({ kind: "todo", targetId: "todo-1" })]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 1, applied: 0, acknowledged: 1 });
    expect((await db.todos.get("todo-1"))?.completed_at).toBeNull();
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("原生确认失败后用户恢复待办时不会重放旧完成动作", async () => {
    await db.todos.add({
      ...todoRecord(),
      updated_at: "2026-09-03T02:05:00.000Z",
      completed_at: null
    });
    const bridge = completionBridge([action({
      kind: "todo",
      targetId: "todo-1",
      createdAt: "2026-09-03T02:00:00.000Z"
    })]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 1, applied: 0, acknowledged: 1 });
    expect((await db.todos.get("todo-1"))?.completed_at).toBeNull();
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("原生确认失败后用户恢复单次日程时不会重放旧完成动作", async () => {
    await db.events.add(eventRecord());
    await db.eventOccurrenceStates.add({
      ...syncFields(undefined, "alice"),
      id: "event-1:2026-09-03",
      updated_at: "2026-09-03T02:05:00.000Z",
      event_id: "event-1",
      occurrence_date: "2026-09-03",
      completed: false,
      reminder_sent_at: null
    });
    const bridge = completionBridge([action({
      actionId: "b".repeat(64),
      kind: "event",
      targetId: "event-1",
      occurrenceDate: "2026-09-03",
      createdAt: "2026-09-03T02:00:00.000Z"
    })]);

    const result = await consumePendingWidgetCompletionActions("alice", bridge);

    expect(result).toEqual({ received: 1, applied: 0, acknowledged: 1 });
    expect((await db.eventOccurrenceStates.get("event-1:2026-09-03"))?.completed).toBe(false);
    expect(await db.syncQueue.count()).toBe(0);
  });
});

function completionBridge(actions: ScheduleWidgetCompletionAction[]): CompletionBridge {
  return {
    getPendingCompletionActions: vi.fn().mockResolvedValue({ accepted: true, actions }),
    ackCompletionActions: vi.fn().mockImplementation(async ({ actionIds }: { actionIds: string[] }) => ({
      accepted: true,
      acknowledged: actionIds.length
    }))
  };
}

function action(overrides: Partial<ScheduleWidgetCompletionAction>): ScheduleWidgetCompletionAction {
  return {
    actionId: "a".repeat(64),
    kind: "todo",
    targetId: "todo-1",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function todoRecord(): TodoItem {
  return {
    ...syncFields(undefined, "alice"),
    id: "todo-1",
    title: "整理资料",
    color: "#ccecf7",
    sort_order: 100,
    is_pinned: false,
    completed_at: null
  };
}

function eventRecord(): EventItem {
  return {
    ...syncFields(undefined, "alice"),
    id: "event-1",
    event_type: "event",
    title: "每日复习",
    start_date: "2026-09-01",
    start_time: "09:00",
    end_date: "2026-09-10",
    end_time: "10:00",
    all_day: false,
    category_id: null,
    color: "#3157d5",
    note: "",
    recurrence_type: "daily",
    recurrence_until: "2026-09-10",
    recurrence_interval: 1,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    completed_at: null
  };
}
