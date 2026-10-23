import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { db } from "../db";
import type { Category } from "../types";
import { BACKUP_TABLES, createBackup } from "./backup";

const firstUserId = "22222222-2222-4222-8222-222222222222";
const secondUserId = "33333333-3333-4333-8333-333333333333";

function category(id: string, userId: string, name: string): Category {
  return {
    id,
    user_id: userId,
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    name,
    color: "#3157d5",
    icon: "book-open"
  };
}

describe("备份账号隔离", () => {
  beforeEach(async () => {
    for (const tableName of BACKUP_TABLES) await db.table(tableName).clear();
  });

  it("只导出指定账号的数据", async () => {
    await db.categories.bulkPut([
      category("category-first", firstUserId, "账号一"),
      category("category-second", secondUserId, "账号二"),
      category("category-local", "local", "匿名")
    ]);

    const backup = await createBackup(firstUserId);

    expect(backup.owner_id).toBe(firstUserId);
    expect(backup.data.categories).toHaveLength(1);
    expect(backup.data.categories[0]).toMatchObject({ user_id: firstUserId, name: "账号一" });
  });

  it("跨表修改与导出交错时仍读取同一个一致快照", async () => {
    const originalCategory = category("category-snapshot", firstUserId, "修改前");
    await db.categories.put(originalCategory);
    await db.table("events").put({ ...originalCategory, id: "event-snapshot", title: "修改前" });
    let concurrentWrite: Promise<unknown> | undefined;
    const onCategoryRead = (record: Category) => {
      if (!concurrentWrite) {
        // Use an independent real Dexie transaction, as another tab/edit would.
        // It is queued during the categories read, before the later events read.
        concurrentWrite = Dexie.ignoreTransaction(() => db.transaction("rw", db.categories, db.events, async () => {
          await db.categories.update(originalCategory.id, { name: "修改后" });
          await db.events.update("event-snapshot", { title: "修改后" });
        }));
      }
      return record;
    };
    db.categories.hook("reading", onCategoryRead);
    try {
      const backup = await createBackup(firstUserId);
      await concurrentWrite;

      expect(backup.data.categories[0]).toMatchObject({ name: "修改前" });
      expect(backup.data.events[0]).toMatchObject({ title: "修改前" });
      expect((await db.events.get("event-snapshot"))?.title).toBe("修改后");
    } finally {
      db.categories.hook("reading").unsubscribe(onCategoryRead);
    }
  });
});
