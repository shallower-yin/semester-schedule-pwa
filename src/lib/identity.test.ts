import { beforeEach, describe, expect, it } from "vitest";
import { getCurrentUserId, setCurrentUserId, syncFields } from "./identity";

describe("本地数据归属", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("semester-schedule-device-id", "11111111-1111-4111-8111-111111111111");
  });

  it("登录后新记录使用当前用户 ID", () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    setCurrentUserId(userId);
    const fields = syncFields({
      id: "33333333-3333-4333-8333-333333333333",
      created_at: "2026-01-01T00:00:00.000Z",
      version: 2
    });
    expect(getCurrentUserId()).toBe(userId);
    expect(fields.user_id).toBe(userId);
    expect(fields.version).toBe(3);
  });

  it("退出登录后恢复本地匿名归属", () => {
    setCurrentUserId("22222222-2222-4222-8222-222222222222");
    setCurrentUserId(null);
    expect(getCurrentUserId()).toBe("local");
  });
});
