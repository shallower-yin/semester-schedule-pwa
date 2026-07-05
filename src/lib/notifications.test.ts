import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./notifications";

describe("通知异步超时", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常操作直接返回结果", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "不应超时")).resolves.toBe("ok");
  });

  it("系统推送无响应时返回明确错误而不是永久等待", async () => {
    vi.useFakeTimers();
    const result = expect(
      withTimeout(new Promise<never>(() => undefined), 100, "连接手机系统推送服务超时")
    ).rejects.toThrow("连接手机系统推送服务超时");
    await vi.advanceTimersByTimeAsync(100);
    await result;
  });
});
