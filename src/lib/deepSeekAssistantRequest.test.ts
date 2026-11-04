import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askDeepSeekAssistant } from "./deepSeekAssistant";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke } } }));

describe("AI 助手请求取消", () => {
  beforeEach(() => invoke.mockReset());
  afterEach(() => vi.useRealTimers());

  it("请求前已取消时不调用服务", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(askDeepSeekAssistant("问题", {}, "", [], [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("将信号传递给网络调用并拒绝取消后的迟到回答", async () => {
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const request = askDeepSeekAssistant("问题", {}, "", [], [], controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finish({ data: { answer: "迟到回答" }, error: null });
    await rejected;
    expect(invoke).toHaveBeenCalledWith("ai-assistant", expect.objectContaining({ signal: controller.signal }));
  });

  it("重试等待期间取消不会再发请求", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
    const request = askDeepSeekAssistant("问题", {}, "", [], [], controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
