import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { inferBackupOwnerId, SCHEDULE_DB_V13_STORES, SCHEDULE_DB_V14_STORES } from "./db";
import type { BackupFile } from "./types";

function backup(records: Array<{ user_id: string }>, ownerId?: string): BackupFile {
  return {
    format: "semester-schedule-backup",
    schema_version: 1,
    ...(ownerId ? { owner_id: ownerId } : {}),
    exported_at: "2026-08-30T00:00:00.000Z",
    data: { events: records } as BackupFile["data"]
  };
}

describe("旧本地快照归属迁移", () => {
  it("优先保留快照声明的账号", () => {
    expect(inferBackupOwnerId(backup([{ user_id: "alice" }], "declared"))).toBe("declared");
  });

  it("从单一记录账号推导归属", () => {
    expect(inferBackupOwnerId(backup([{ user_id: "alice" }, { user_id: "alice" }]))).toBe("alice");
  });

  it("多账号快照保持歧义，避免迁移时误删内容", () => {
    expect(inferBackupOwnerId(backup([{ user_id: "alice" }, { user_id: "bob" }]))).toBeNull();
  });
});

describe("待办数据库升级兼容", () => {
  it("v13 升到 v14 后旧版仍可打开旧表，重新回到 v14 也不丢待办", async () => {
    const databaseName = `semester-schedule-downgrade-${crypto.randomUUID()}`;
    const connections: Dexie[] = [];
    const makeV13 = () => {
      const database = new Dexie(databaseName);
      database.version(13).stores(SCHEDULE_DB_V13_STORES);
      connections.push(database);
      return database;
    };
    const makeV14 = () => {
      const database = new Dexie(databaseName);
      database.version(13).stores(SCHEDULE_DB_V13_STORES);
      database.version(14).stores(SCHEDULE_DB_V14_STORES);
      connections.push(database);
      return database;
    };

    try {
      expect(Object.keys(SCHEDULE_DB_V14_STORES).filter((name) => !(name in SCHEDULE_DB_V13_STORES))).toEqual(["todos"]);

      const beforeUpgrade = makeV13();
      await beforeUpgrade.open();
      await beforeUpgrade.table("categories").put({ id: "category-before", name: "升级前数据" });
      beforeUpgrade.close();

      const upgraded = makeV14();
      await upgraded.open();
      await upgraded.table("todos").put({
        id: "todo-after-upgrade",
        user_id: "local",
        title: "升级后待办",
        color: "#ccecf7",
        sort_order: 100,
        is_pinned: false,
        completed_at: null,
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z",
        deleted_at: null,
        version: 1,
        device_id: "test-device"
      });
      await upgraded.table("syncQueue").put({
        id: "todo-queue",
        owner_id: "local",
        table_name: "todos",
        record_id: "todo-after-upgrade",
        operation: "upsert",
        queued_at: "2026-09-02T00:00:00.000Z",
        attempts: 0,
        last_error: null
      });
      expect(upgraded.backendDB().version).toBe(140);
      upgraded.close();

      // Dexie 4 retries without a requested native version after VersionError.
      // The old schema therefore exposes only its known stores while leaving
      // the v14-only todo store untouched in the same IndexedDB database.
      const rolledBack = makeV13();
      await rolledBack.open();
      expect(rolledBack.verno).toBe(13);
      expect(rolledBack.backendDB().version).toBe(140);
      expect(rolledBack.tables.map((table) => table.name)).not.toContain("todos");
      expect(await rolledBack.table("categories").get("category-before")).toMatchObject({ name: "升级前数据" });
      expect(await rolledBack.table("syncQueue").get("todo-queue")).toMatchObject({ table_name: "todos" });
      await rolledBack.table("categories").put({ id: "category-from-v13", name: "旧版期间写入" });
      rolledBack.close();

      const reopened = makeV14();
      await reopened.open();
      expect(reopened.backendDB().version).toBe(140);
      expect(await reopened.table("todos").get("todo-after-upgrade")).toMatchObject({ title: "升级后待办" });
      expect(await reopened.table("categories").get("category-from-v13")).toMatchObject({ name: "旧版期间写入" });
      expect(await reopened.table("syncQueue").get("todo-queue")).toMatchObject({ record_id: "todo-after-upgrade" });
    } finally {
      for (const connection of connections) connection.close();
      await Dexie.delete(databaseName);
    }
  });
});
