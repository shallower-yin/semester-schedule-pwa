import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: invokeMock } }
}));

import { askAiMindMap } from "./mindMap";

describe("思维导图请求", () => {
  beforeEach(() => invokeMock.mockReset());

  it("失败时保留原因且不会自动重复请求", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("脑图 JSON 不完整") });

    await expect(askAiMindMap({ prompt: "总结附件", depth: "standard" }))
      .rejects.toThrow("脑图 JSON 不完整");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
