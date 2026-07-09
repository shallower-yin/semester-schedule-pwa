import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { Category } from "../types";
import { BACKUP_TABLES } from "./backup";
import { getLastBackupAt, markBackupCompleted } from "./backupStatus";
import { createLocalBackupSnapshot, ensureScheduledLocalBackup } from "./autoBackup";

const userId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-07-01T00:00:00.000Z";

function category(): Category {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: userId,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    name: "学习",
    color: "#4f6bdc",
    icon: "book-open"
  };
}

describe("本机自动备份快照", () => {
  beforeEach(async () => {
    localStorage.clear();
    for (const tableName of BACKUP_TABLES) {
      await db.table(tableName).clear();
    }
    await db.localBackupSnapshots.clear();
  });

  it("超过备份间隔时静默生成本机快照并更新备份状态", async () => {
    await db.categories.put(category());

    const snapshot = await ensureScheduledLocalBackup(new Date("2026-07-09T08:00:00.000Z"));

    expect(snapshot?.reason).toBe("scheduled");
    expect(snapshot?.record_count).toBe(1);
    expect(snapshot?.backup.exported_at).toBe("2026-07-09T08:00:00.000Z");
    expect(await db.localBackupSnapshots.count()).toBe(1);
    expect(getLastBackupAt()).toBe("2026-07-09T08:00:00.000Z");
  });

  it("未超过备份间隔时不重复生成", async () => {
    markBackupCompleted(new Date("2026-07-09T08:00:00.000Z"));

    const snapshot = await ensureScheduledLocalBackup(new Date("2026-07-12T08:00:00.000Z"));

    expect(snapshot).toBeNull();
    expect(await db.localBackupSnapshots.count()).toBe(0);
  });

  it("只保留最近 3 份本机快照", async () => {
    for (let day = 1; day <= 5; day += 1) {
      await createLocalBackupSnapshot("manual", new Date(`2026-07-0${day}T08:00:00.000Z`));
    }

    const snapshots = await db.localBackupSnapshots.orderBy("created_at").toArray();

    expect(snapshots.map((snapshot) => snapshot.created_at)).toEqual([
      "2026-07-03T08:00:00.000Z",
      "2026-07-04T08:00:00.000Z",
      "2026-07-05T08:00:00.000Z"
    ]);
  });
});
