import { beforeEach, describe, expect, it } from "vitest";
import { getCurrentUserId, setCurrentUserId, syncFields } from "./identity";

describe("本地数据归属", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("semester-schedule-device-id", "11111111-1111-4111-8111-111111111111");
  });

  it("新记录使用调用方显式传入的用户 ID", () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    setCurrentUserId(userId);
    const fields = syncFields(undefined, userId);
    expect(getCurrentUserId()).toBe(userId);
    expect(fields.user_id).toBe(userId);
    expect(fields.version).toBe(1);
  });

  it("新记录缺少 ownerId 时明确拒绝，不会回退到共享身份", () => {
    setCurrentUserId("bob");
    // @ts-expect-error 新建记录必须在类型层显式传入 ownerId。
    expect(() => syncFields()).toThrow("必须显式指定 ownerId");
  });

  it("退出登录后恢复本地匿名归属", () => {
    setCurrentUserId("22222222-2222-4222-8222-222222222222");
    setCurrentUserId(null);
    expect(getCurrentUserId()).toBe("local");
  });

  it("异步更新开始后即使当前账号改变，也保留已有记录的原归属", () => {
    setCurrentUserId("bob");

    const fields = syncFields({
      id: "33333333-3333-4333-8333-333333333333",
      user_id: "alice",
      created_at: "2026-01-01T00:00:00.000Z",
      version: 2
    });
    const explicit = syncFields(undefined, "alice");

    expect(fields.user_id).toBe("alice");
    expect(explicit.user_id).toBe("alice");
  });

  it("拒绝用另一个账号更新已有记录，避免跨账号重挂归属", () => {
    expect(() => syncFields({
      id: "memo-1",
      user_id: "alice",
      created_at: "2026-01-01T00:00:00.000Z",
      version: 1
    }, "bob")).toThrow("必须与已有记录一致");
  });
});
