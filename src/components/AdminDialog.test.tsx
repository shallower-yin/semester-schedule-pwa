import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminSummaryMock } = vi.hoisted(() => ({ getAdminSummaryMock: vi.fn() }));

vi.mock("../lib/admin", () => ({
  getAdminSummary: getAdminSummaryMock,
  getAdminUserDetails: vi.fn(),
  saveAdminAiAccess: vi.fn(),
  saveAdminAiSettings: vi.fn()
}));

import { AdminDialog } from "./AdminDialog";

describe("管理后台 AI 模型选择", () => {
  beforeEach(() => {
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
        updated_at: null
      }
    });
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
});
