import { describe, expect, it } from "vitest";
import { prepareBackupRecordsForRestore } from "./backup";

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
});
