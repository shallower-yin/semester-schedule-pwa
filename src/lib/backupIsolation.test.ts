import { beforeEach, describe, expect, it } from "vitest";
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
});
