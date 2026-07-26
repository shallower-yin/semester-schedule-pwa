import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cleanupAdminTransientDataMock, getAdminSummaryMock, getAdminAiCallLogsMock } = vi.hoisted(() => ({
  cleanupAdminTransientDataMock: vi.fn(),
  getAdminSummaryMock: vi.fn(),
  getAdminAiCallLogsMock: vi.fn()
}));

vi.mock("../lib/admin", () => ({
  getAdminSummary: getAdminSummaryMock,
  getAdminAiCallLogs: getAdminAiCallLogsMock,
  cleanupAdminTransientData: cleanupAdminTransientDataMock,
  getAdminUserDetails: vi.fn(),
  saveAdminAiAccess: vi.fn(),
  saveAdminAiSettings: vi.fn(),
  setAdminAccountBan: vi.fn()
}));

import { AdminDialog } from "./AdminDialog";

describe("管理后台 AI 模型选择", () => {
  beforeEach(() => {
    cleanupAdminTransientDataMock.mockReset();
    cleanupAdminTransientDataMock.mockResolvedValue({ aiUsageDeleted: 12, reminderDeliveriesDeleted: 5 });
    getAdminAiCallLogsMock.mockResolvedValue([]);
    getAdminSummaryMock.mockResolvedValue({
      passwordVisible: false,
      users: [],
      aiCallLogs: [],
      aiSettings: {
        enabled_for_all: true,
        ordinary_daily_limit: 2,
        ordinary_weekly_limit: 100,
        member_daily_limit: 30,
        member_weekly_limit: 210,
        provider: "mimo",
        model: "mimo-v2.5",
        mimo_channel: "token_plan",
        audio_provider: "siliconflow",
        audio_model: "TeleAI/TeleSpeechASR",
        feature_quotas: {
          assistant: { enabled_for_all: true, ordinary_daily_limit: 2, ordinary_weekly_limit: 100, member_daily_limit: 30, member_weekly_limit: 210 },
          mind_map: { enabled_for_all: true, ordinary_daily_limit: 1, ordinary_weekly_limit: 5, member_daily_limit: 10, member_weekly_limit: 50 },
          audio_transcription: { enabled_for_all: false, ordinary_daily_limit: 0, ordinary_weekly_limit: 0, member_daily_limit: 3, member_weekly_limit: 10 }
        },
        updated_at: null
      }
    });
  });

  afterEach(cleanup);

  it("使用内置主 AI 和音频转写模型下拉框", async () => {
    const { container } = render(<AdminDialog onClose={vi.fn()} />);

    await waitFor(() => expect(getAdminSummaryMock).toHaveBeenCalled());
    const selects = () => Array.from(container.querySelectorAll(".admin-ai-provider-row select")) as HTMLSelectElement[];
    expect(selects().map((select) => select.value)).toEqual([
      "mimo",
      "mimo-v2.5",
      "token_plan",
      "siliconflow",
      "TeleAI/TeleSpeechASR"
    ]);
    expect(screen.getByRole("option", { name: "MiMo V2.5（支持附件）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SiliconFlow TeleAI/TeleSpeechASR" })).toBeInTheDocument();

    fireEvent.change(selects()[0], { target: { value: "siliconflow" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "SiliconFlow Qwen3-32B" })).toBeInTheDocument());
    expect(selects()[0]).toHaveValue("siliconflow");
    expect(selects()[1]).toHaveValue("Qwen/Qwen3-32B");
    expect(selects().some((select) => select.value === "token_plan")).toBe(false);

    fireEvent.change(selects()[0], { target: { value: "tju" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "TJU Agent2026 tju-llm" })).toBeInTheDocument());
    expect(selects()[1]).toHaveValue("tju-llm");
  });

  it("保留音频转写独立通道，不跟随主 AI 供应商切换", async () => {
    const { container } = render(<AdminDialog onClose={vi.fn()} />);

    await waitFor(() => expect(getAdminSummaryMock).toHaveBeenCalled());
    const selects = () => Array.from(container.querySelectorAll(".admin-ai-provider-row select")) as HTMLSelectElement[];
    fireEvent.change(selects()[0], { target: { value: "deepseek" } });
    expect(selects().at(-2)).toHaveValue("siliconflow");
    expect(selects().at(-1)).toHaveValue("TeleAI/TeleSpeechASR");

    fireEvent.change(selects().at(-2)!, { target: { value: "mimo" } });
    expect(selects().at(-2)).toHaveValue("mimo");
    expect(selects().at(-1)).toHaveValue("mimo-v2.5-asr");
  });
});
