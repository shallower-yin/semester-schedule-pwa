import { beforeEach, describe, expect, it } from "vitest";
import { db, queueChange } from "../db";
import { BACKUP_TABLES, createBackup, OPTIONAL_TABLES_IN_OLD_BACKUPS, prepareBackupRecordsForRestore, restoreBackup } from "./backup";

describe("备份恢复同步元数据", () => {
  const currentUserId = "22222222-2222-4222-8222-222222222222";

  it("当前账号的旧备份会成为严格更新的待同步版本", () => {
    const restored = prepareBackupRecordsForRestore(
      [{
        id: "event-1",
        user_id: currentUserId,
        version: 2,
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "备份内容"
      }],
      [{
        id: "event-1",
        user_id: currentUserId,
        version: 8,
        updated_at: "2026-07-31T08:00:00.000Z",
        title: "误改内容"
      }],
      currentUserId,
      new Date("2026-07-31T07:00:00.000Z")
    );

    expect(restored[0]).toMatchObject({
      user_id: currentUserId,
      version: 9,
      title: "备份内容"
    });
    expect(String(restored[0].updated_at)).toBe("2026-07-31T08:00:00.001Z");
  });

  it("接管匿名数据并忽略其他账号的数据", () => {
    const otherUserId = "33333333-3333-4333-8333-333333333333";
    const restored = prepareBackupRecordsForRestore(
      [
        { id: "local-1", user_id: "local", version: 1, updated_at: "2026-01-01T00:00:00.000Z" },
        { id: "other-1", user_id: otherUserId, version: 4, updated_at: "2026-01-02T00:00:00.000Z" }
      ],
      [undefined, undefined],
      currentUserId,
      new Date("2026-07-31T08:00:00.000Z")
    );

    expect(restored[0]).toMatchObject({ user_id: currentUserId, version: 2 });
    expect(restored).toHaveLength(1);
  });

  it("不会采信备份中的未来时间戳", () => {
    const restored = prepareBackupRecordsForRestore(
      [{ id: "event-1", user_id: currentUserId, updated_at: "2099-01-01T00:00:00.000Z", version: 2 }],
      [{ id: "event-1", user_id: currentUserId, updated_at: "2026-07-30T00:00:00.000Z", version: 3 }],
      currentUserId,
      new Date("2026-07-31T00:00:00.000Z")
    );

    expect(restored[0].updated_at).toBe("2026-07-31T00:00:00.001Z");
    expect(restored[0].version).toBe(4);
  });

  it("匿名备份已被其他账号接管后不能覆盖该账号的本地记录", () => {
    expect(() => prepareBackupRecordsForRestore(
      [{ id: "original-local-event", user_id: "local", version: 1 }],
      [{ id: "original-local-event", user_id: "another-account", version: 3 }],
      currentUserId
    )).toThrow("其他账号");
  });

  it("允许当前账号恢复尚未被接管的同一条匿名记录", () => {
    const restored = prepareBackupRecordsForRestore(
      [{ id: "local-event", user_id: "local", version: 1 }],
      [{ id: "local-event", user_id: "local", version: 2 }],
      currentUserId
    );
    expect(restored[0]).toMatchObject({ id: "local-event", user_id: currentUserId, version: 3 });
  });

  it("待办缺失不会使旧版备份失效", () => {
    expect(OPTIONAL_TABLES_IN_OLD_BACKUPS.has("todos")).toBe(true);
  });
});

describe("备份恢复跨表事务", () => {
  const ownerId = "restore-owner";
  const original = {
    user_id: ownerId,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "restore-device"
  };

  beforeEach(async () => {
    for (const table of BACKUP_TABLES) await db.table(table).clear();
    await db.syncQueue.clear();
  });

  it.each(["owner-conflict", "write-failure"])("后表失败会回滚前表及队列的所有写入：%s", async (failure) => {
    const category = { ...original, id: "restore-category", name: "当前分类" };
    const event = {
      ...original,
      id: "restore-event",
      title: "当前事项",
      user_id: failure === "owner-conflict" ? "other-owner" : ownerId
    };
    await db.table("categories").put(category);
    await db.table("events").put(event);
    await queueChange("categories", category.id, "upsert", ownerId);
    const originalQueue = await db.syncQueue.toArray();
    const backup = await createBackup(ownerId);
    backup.data.categories[0] = { ...category, name: "备份分类" };
    backup.data.events = [{ ...event, user_id: "local", title: "备份事项" }];
    const failWrite = () => { throw new Error("injected restore write failure"); };
    if (failure === "write-failure") db.events.hook("updating", failWrite);
    try {
      await expect(restoreBackup(backup, ownerId)).rejects.toThrow(
        failure === "owner-conflict" ? "其他账号" : "injected restore write failure"
      );
      expect(await db.categories.get(category.id)).toEqual(category);
      expect(await db.events.get(event.id)).toEqual(event);
      expect(await db.syncQueue.toArray()).toEqual(originalQueue);
    } finally {
      db.events.hook("updating").unsubscribe(failWrite);
    }
  });

  it("成功恢复一次提交所有表及对应队列，支持外层事务", async () => {
    await db.table("categories").put({ ...original, id: "restore-category", name: "备份分类" });
    await db.table("events").put({ ...original, id: "restore-event", title: "备份事项" });
    const backup = await createBackup(ownerId);
    await db.categories.clear();
    await db.events.clear();

    await db.transaction("rw", [...BACKUP_TABLES.map((table) => db.table(table)), db.syncQueue], async () => {
      await restoreBackup(backup, ownerId);
    });

    expect((await db.categories.get("restore-category"))?.name).toBe("备份分类");
    expect((await db.events.get("restore-event"))?.title).toBe("备份事项");
    expect((await db.syncQueue.toArray()).map((row) => row.record_id).sort()).toEqual(["restore-category", "restore-event"]);
  });
});
