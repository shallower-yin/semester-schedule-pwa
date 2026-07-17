import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cleanupAdminTransientDataMock, getAdminSummaryMock } = vi.hoisted(() => ({
  cleanupAdminTransientDataMock: vi.fn(),
  getAdminSummaryMock: vi.fn()
}));

vi.mock("../lib/admin", () => ({
  getAdminSummary: getAdminSummaryMock,
  cleanupAdminTransientData: cleanupAdminTransientDataMock,
  getAdminUserDetails: vi.fn(),
  saveAdminAiAccess: vi.fn(),
  saveAdminAiSettings: vi.fn()
}));

import { AdminDialog } from "./AdminDialog";

describe("管理后台 AI 模型选择", () => {
  beforeEach(() => {
    cleanupAdminTransientDataMock.mockReset();
    cleanupAdminTransientDataMock.mockResolvedValue({ aiUsageDeleted: 12, reminderDeliveriesDeleted: 5 });
    getAdminSummaryMock.mockResolvedValue({
      passwordVisible: false,
      users: [],
      aiSettings: {
        enabled_for_all: true,
        ordinary_daily_limit: 2,
        ordinary_weekly_limit: 100,
        member_daily_limit: 30,
        member_weekly_limit: 210,
        provider: "mimo",
        model: "mimo-v2.5",
        mimo_channel: "token_plan",
        feature_quotas: {
          assistant: { enabled_for_all: true, ordinary_daily_limit: 2, ordinary_weekly_limit: 100, member_daily_limit: 30, member_weekly_limit: 210 },
          mind_map: { enabled_for_all: true, ordinary_daily_limit: 1, ordinary_weekly_limit: 5, member_daily_limit: 10, member_weekly_limit: 50 },
          audio_transcription: { enabled_for_all: false, ordinary_daily_limit: 0, ordinary_weekly_limit: 0, member_daily_limit: 3, member_weekly_limit: 10 }
        },
        updated_at: null
      }
    });
  });

  it("为三个 AI 功能分别显示可填 0 的额度", async () => {
    render(<AdminDialog onClose={vi.fn()} />);

    expect(await screen.findByLabelText("AI 助手普通用户每日额度")).toHaveValue(2);
    expect(screen.getByLabelText("AI 思维导图普通用户每日额度")).toHaveValue(1);
    expect(screen.getByLabelText("音频转写普通用户每日额度")).toHaveValue(0);
    expect(screen.getByLabelText("音频转写全员开放")).toHaveValue("0");
  });

  afterEach(cleanup);

  it("使用不可自由输入的内置模型下拉框，并随提供商切换选项", async () => {
    render(<AdminDialog onClose={vi.fn()} />);

    const modelSelect = await screen.findByLabelText("模型");
    expect(modelSelect.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "MiMo V2.5（支持附件）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "MiMo V2.5 Pro UltraSpeed（需申请）" })).toBeInTheDocument();
    expect(screen.getByLabelText("MiMo 通道")).toHaveValue("token_plan");

    fireEvent.change(screen.getByLabelText("AI 提供商"), { target: { value: "deepseek" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "DeepSeek V4 Pro" })).toBeInTheDocument());
    expect(modelSelect).toHaveValue("deepseek-v4-flash");
    expect(screen.queryByLabelText("MiMo 通道")).not.toBeInTheDocument();
  });

  it("只清理超过保留期的临时云端记录", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "用户与清理" }));
    await screen.findByText("临时数据清理");

    fireEvent.change(screen.getByLabelText("临时数据保留天数"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "清理过期记录" }));

    await waitFor(() => expect(cleanupAdminTransientDataMock).toHaveBeenCalledWith(120, undefined));
    expect(await screen.findByText("清理完成：AI 调用明细 12 条，提醒投递日志 5 条。")).toBeInTheDocument();
  });
});
