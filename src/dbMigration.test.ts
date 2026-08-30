import { describe, expect, it } from "vitest";
import { inferBackupOwnerId } from "./db";
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
