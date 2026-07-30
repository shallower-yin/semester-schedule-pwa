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
  deleteAdminAiRelay: vi.fn(),
  saveAdminAiRelay: vi.fn(),
  testAdminAiRelay: vi.fn(),
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
      aiRelays: [],
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
        text_relay_id: null,
        audio_relay_id: null,
        feature_quotas: {
          assistant: { enabled_for_all: true, ordinary_daily_limit: 2, ordinary_weekly_limit: 100, member_daily_limit: 30, member_weekly_limit: 210 },
          translation: { enabled_for_all: true, ordinary_daily_limit: 50, ordinary_weekly_limit: 300, member_daily_limit: 150, member_weekly_limit: 900 },
          mind_map: { enabled_for_all: true, ordinary_daily_limit: 1, ordinary_weekly_limit: 5, member_daily_limit: 10, member_weekly_limit: 50 },
          audio_transcription: { enabled_for_all: false, ordinary_daily_limit: 0, ordinary_weekly_limit: 0, member_daily_limit: 3, member_weekly_limit: 10 }
        },
        updated_at: null
      }
    });
  });

  afterEach(cleanup);

  it("使用内置主 AI 和音频转写模型下拉框", async () => {
    render(<AdminDialog onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    expect(screen.getByLabelText("模型")).toHaveValue("mimo-v2.5");
    expect(screen.getByLabelText("MiMo 通道")).toHaveValue("token_plan");
    expect(screen.getByLabelText("内置转写通道")).toHaveValue("siliconflow");
    expect(screen.getByLabelText("转写模型")).toHaveValue("TeleAI/TeleSpeechASR");
    expect(screen.getByRole("option", { name: "MiMo V2.5（支持附件）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SiliconFlow TeleAI/TeleSpeechASR" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "siliconflow" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "SiliconFlow Qwen3-32B" })).toBeInTheDocument());
    expect(screen.getByLabelText("内置提供商")).toHaveValue("siliconflow");
    expect(screen.getByLabelText("模型")).toHaveValue("Qwen/Qwen3-32B");
    expect(screen.queryByLabelText("MiMo 通道")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "tju" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "TJU Agent2026 tju-llm" })).toBeInTheDocument());
    expect(screen.getByLabelText("模型")).toHaveValue("tju-llm");
  });

  it("保留音频转写独立通道，不跟随主 AI 供应商切换", async () => {
    render(<AdminDialog onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("转写模型")).toHaveValue("TeleAI/TeleSpeechASR"));
    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "deepseek" } });
    expect(screen.getByLabelText("内置转写通道")).toHaveValue("siliconflow");
    expect(screen.getByLabelText("转写模型")).toHaveValue("TeleAI/TeleSpeechASR");

    fireEvent.change(screen.getByLabelText("内置转写通道"), { target: { value: "mimo" } });
    expect(screen.getByLabelText("内置转写通道")).toHaveValue("mimo");
    expect(screen.getByLabelText("转写模型")).toHaveValue("mimo-v2.5-asr");
  });

  it("新增中转站时分开配置文本与音频能力", async () => {
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增中转站" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新增中转站" }));
    expect(screen.getByLabelText("接口协议")).toHaveValue("openai_compatible");
    expect(screen.getByLabelText("启用文本 AI")).toBeChecked();
    expect(screen.getByLabelText("启用音频转写")).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("接口协议"), { target: { value: "mimo" } });
    expect(screen.getByLabelText("API 基础地址")).toHaveValue("https://api.xiaomimimo.com/v1");
    expect(screen.getByLabelText("文本模型 ID")).toHaveValue("mimo-v2.5");

    fireEvent.change(screen.getByLabelText("接口协议"), { target: { value: "deepseek" } });
    expect(screen.getByLabelText("启用音频转写")).toBeDisabled();
    expect(screen.getByLabelText("音频模型 ID")).toBeDisabled();
  });
});
