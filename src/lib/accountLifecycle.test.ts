import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { Category, LocalBackupSnapshot } from "../types";
import { AI_TASK_STORAGE_KEY, startAiTask } from "./aiBackgroundTasks";
import { clearLocalAccountData } from "./accountLifecycle";

const now = "2026-07-31T00:00:00.000Z";

describe("账号本机数据清理", () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.categories.clear();
    await db.syncQueue.clear();
    await db.localBackupSnapshots.clear();
    await db.aiAttachmentContexts.clear();
  });

  it("只删除指定账号的数据、队列、快照和本地上下文", async () => {
    await db.categories.bulkPut([category("a", "user-a"), category("b", "user-b")]);
    await db.syncQueue.bulkPut([
      queue("qa", "user-a", "a"),
      queue("qb", "user-b", "b")
    ]);
    await db.localBackupSnapshots.bulkPut([
      snapshot("sa", "user-a"),
      snapshot("sb", "user-b")
    ]);
    await db.aiAttachmentContexts.bulkPut([
      { id: "aa", ownerId: "user-a", attachments: [], updatedAt: now },
      { id: "ab", ownerId: "user-b", attachments: [], updatedAt: now }
    ]);
    localStorage.setItem("semester-schedule-mind-map:user-a", "private-a");
    localStorage.setItem("semester-schedule-mind-map:user-b", "private-b");
    startAiTask({
      feature: "translation",
      label: "翻译测试",
      run: () => new Promise(() => undefined)
    });

    await clearLocalAccountData("user-a");

    expect(await db.categories.toArray()).toEqual([expect.objectContaining({ id: "b", user_id: "user-b" })]);
    expect(await db.syncQueue.toArray()).toEqual([expect.objectContaining({ id: "qb", owner_id: "user-b" })]);
    expect(await db.localBackupSnapshots.toArray()).toEqual([expect.objectContaining({ id: "sb", owner_id: "user-b" })]);
    expect(await db.aiAttachmentContexts.toArray()).toEqual([expect.objectContaining({ id: "ab", ownerId: "user-b" })]);
    expect(localStorage.getItem("semester-schedule-mind-map:user-a")).toBeNull();
    expect(localStorage.getItem("semester-schedule-mind-map:user-b")).toBe("private-b");
    expect(localStorage.getItem(AI_TASK_STORAGE_KEY)).toBeNull();
  });
});

function category(id: string, userId: string): Category {
  return {
    id,
    user_id: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    device_id: "device",
    name: id,
    color: "#3157d5",
    icon: "book"
  };
}

function queue(id: string, ownerId: string, recordId: string) {
  return {
    id,
    owner_id: ownerId,
    table_name: "categories" as const,
    record_id: recordId,
    operation: "upsert" as const,
    queued_at: now,
    attempts: 0,
    last_error: null
  };
}

function snapshot(id: string, ownerId: string): LocalBackupSnapshot {
  return {
    id,
    owner_id: ownerId,
    created_at: now,
    reason: "manual",
    record_count: 0,
    backup: {
      format: "semester-schedule-backup",
      schema_version: 1,
      owner_id: ownerId,
      exported_at: now,
      data: {} as LocalBackupSnapshot["backup"]["data"]
    }
  };
}
