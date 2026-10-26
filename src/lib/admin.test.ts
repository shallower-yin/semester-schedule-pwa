import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, invokeMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), invokeMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } }
}));

import { getAdminSummary } from "./admin";

describe("管理后台模型配置兼容", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { relays: [] }, error: null });
  });

  function mockSettings(provider: string, model: string) {
    rpcMock.mockImplementation(async (name: string) => ({
      data: name === "admin_get_ai_settings"
        ? { provider, model, audio_provider: "mimo", audio_model: "mimo-v2.5-asr" }
        : [],
      error: null
    }));
  }

  it.each([
    ["mimo-v2.5", "mimo-v2.6-flash"],
    [" mimo-v2.5-pro ", "mimo-v2.6-pro"],
    ["mimo-v2.6-flash", "mimo-v2.6-flash"],
    ["mimo-v2.6-pro", "mimo-v2.6-pro"],
    ["mimo-v2.5-pro-ultraspeed", "mimo-v2.5-pro-ultraspeed"]
  ])("读取 %s 时保持对应型号为 %s", async (storedModel, expectedModel) => {
    mockSettings("mimo", storedModel);

    const summary = await getAdminSummary();

    expect(summary.aiSettings).toMatchObject({
      provider: "mimo",
      model: expectedModel,
      audio_provider: "mimo",
      audio_model: "mimo-v2.5-asr"
    });
  });

  it("其他提供商不套用 MiMo 型号迁移", async () => {
    mockSettings("deepseek", "mimo-v2.5-pro");

    const summary = await getAdminSummary();

    expect(summary.aiSettings.provider).toBe("deepseek");
    expect(summary.aiSettings.model).toBe("deepseek-v4-flash");
  });
});
