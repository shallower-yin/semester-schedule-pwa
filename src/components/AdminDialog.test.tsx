import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cleanupAdminTransientDataMock, getAdminSummaryMock, getAdminAiCallLogsMock, saveAdminAiSettingsMock, testAdminAiRelayMock, saveAdminAiRelayMock, saveAdminAiAccessMock, deleteAdminAiRelayMock, getAdminUserDetailsMock } = vi.hoisted(() => ({
  cleanupAdminTransientDataMock: vi.fn(),
  getAdminSummaryMock: vi.fn(),
  getAdminAiCallLogsMock: vi.fn(),
  saveAdminAiSettingsMock: vi.fn(),
  testAdminAiRelayMock: vi.fn(),
  saveAdminAiRelayMock: vi.fn(),
  saveAdminAiAccessMock: vi.fn(),
  deleteAdminAiRelayMock: vi.fn(),
  getAdminUserDetailsMock: vi.fn()
}));

vi.mock("../lib/admin", () => ({
  getAdminSummary: getAdminSummaryMock,
  getAdminAiCallLogs: getAdminAiCallLogsMock,
  cleanupAdminTransientData: cleanupAdminTransientDataMock,
  getAdminUserDetails: getAdminUserDetailsMock,
  deleteAdminAiRelay: deleteAdminAiRelayMock,
  saveAdminAiRelay: saveAdminAiRelayMock,
  testAdminAiRelay: testAdminAiRelayMock,
  saveAdminAiAccess: saveAdminAiAccessMock,
  saveAdminAiSettings: saveAdminAiSettingsMock,
  setAdminAccountBan: vi.fn()
}));

import { AdminDialog } from "./AdminDialog";
import type { AdminAiRelay, AdminAiSettings, AdminSummary, AdminUserDetails, AdminUserSummary } from "../lib/admin";

describe("管理后台 AI 模型选择", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cleanupAdminTransientDataMock.mockResolvedValue({ aiUsageDeleted: 12, reminderDeliveriesDeleted: 5 });
    getAdminAiCallLogsMock.mockResolvedValue([]);
    getAdminSummaryMock.mockResolvedValue(summaryFixture());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("使用内置主 AI 和音频转写模型下拉框", async () => {
    render(<AdminDialog onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    expect(screen.getByLabelText("模型")).toHaveValue("mimo-v2.6-flash");
    expect(screen.getByLabelText("MiMo 通道")).toHaveValue("token_plan");
    expect(screen.getByLabelText("内置转写通道")).toHaveValue("siliconflow");
    expect(screen.getByLabelText("转写模型")).toHaveValue("TeleAI/TeleSpeechASR");
    expect(screen.getByRole("option", { name: "MiMo V2.6 Flash（支持附件）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "MiMo V2.6 Pro（支持附件）" })).toBeInTheDocument();
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
    expect(screen.getByLabelText("文本模型 ID")).toHaveValue("mimo-v2.6-flash");

    fireEvent.change(screen.getByLabelText("接口协议"), { target: { value: "deepseek" } });
    expect(screen.getByLabelText("启用音频转写")).toBeDisabled();
    expect(screen.getByLabelText("音频模型 ID")).toBeDisabled();
  });
  it("刷新账号汇总不会覆盖尚未保存的模型与额度", async () => {
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(getAdminSummaryMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).not.toBeDisabled());
    expect(screen.getByLabelText("内置提供商")).toHaveValue("deepseek");
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(7);
  });

  it("测试中转站后的汇总刷新不会覆盖未保存的配置", async () => {
    getAdminSummaryMock.mockResolvedValue({
      ...summaryFixture(),
      aiRelays: [{
        id: "relay", name: "测试中转", protocol: "openai_compatible", baseUrl: "https://relay.example/v1",
        keyConfigured: true, supportsText: true, textModel: "test-model", supportsAudio: false, audioModel: null,
        lastTestedAt: null, lastTestStatus: null, lastTestMessage: null, lastTestLatencyMs: null, createdAt: null, updatedAt: null
      }]
    });
    testAdminAiRelayMock.mockResolvedValue({ ok: true, kind: "text", status: 200, latencyMs: 12, message: "连接成功" });
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "测文本" }));
    await waitFor(() => expect(screen.getByText(/测试中转：连接成功/)).toBeInTheDocument());
    expect(testAdminAiRelayMock).toHaveBeenCalledWith("relay", "text");
    expect(screen.getByLabelText("内置提供商")).toHaveValue("deepseek");
  });

  it("保存失败保留草稿，重试仍提交用户输入", async () => {
    saveAdminAiSettingsMock.mockRejectedValueOnce(new Error("保存暂时失败"));
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    await screen.findByText("保存暂时失败");
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(7);
    saveAdminAiSettingsMock.mockImplementationOnce(async (payload) => ({ ...payload, updated_at: null }));
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    await screen.findByText("AI 模型与分项权限额度已保存。");
    expect(saveAdminAiSettingsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ ordinary_daily_limit: 7 }));
  });

  it("保存成功采用服务端结果作为新基线，未继续编辑时刷新可更新配置", async () => {
    const saved = summaryFixture().aiSettings;
    saved.ordinary_daily_limit = 8;
    saved.feature_quotas.assistant.ordinary_daily_limit = 8;
    saveAdminAiSettingsMock.mockResolvedValue(saved);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    await screen.findByText("AI 模型与分项权限额度已保存。");
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(8);
    const refreshed = summaryFixture();
    refreshed.aiSettings.feature_quotas.assistant.ordinary_daily_limit = 9;
    getAdminSummaryMock.mockResolvedValueOnce(refreshed);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(9));
  });

  it("保存期间的新输入不会被迟到保存响应或随后刷新覆盖", async () => {
    const pending = deferred<AdminAiSettings>();
    saveAdminAiSettingsMock.mockReturnValueOnce(pending.promise);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "9" } });
    const saved = { ...saveAdminAiSettingsMock.mock.calls[0][0], updated_at: null };
    await act(async () => pending.resolve(saved));
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(9);
    expect(screen.getByText("AI 设置已保存，后续修改尚未保存。")).toBeInTheDocument();
    getAdminSummaryMock.mockResolvedValueOnce({ ...summaryFixture(), aiSettings: saved });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).not.toBeDisabled());
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(9);
  });

  it.each(["before", "during"])("保存%s发出的刷新晚于保存返回时不能还原旧配置", async (timing) => {
    const refresh = deferred<AdminSummary>();
    const save = deferred<AdminAiSettings>();
    saveAdminAiSettingsMock.mockReturnValueOnce(save.promise);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    getAdminSummaryMock.mockReturnValueOnce(refresh.promise);
    const startRefresh = () => fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    if (timing === "before") startRefresh();
    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    if (timing === "during") startRefresh();
    await act(async () => save.resolve({ ...saveAdminAiSettingsMock.mock.calls[0][0], updated_at: null }));
    await act(async () => refresh.resolve(summaryFixture()));
    expect(screen.getByLabelText("内置提供商")).toHaveValue("deepseek");
  });

  it("刷新等待期间的输入保留，切换管理分区不销毁配置和中转站草稿", async () => {
    const pending = deferred<AdminSummary>();
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    getAdminSummaryMock.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.change(screen.getByLabelText("内置提供商"), { target: { value: "deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "新增中转站" }));
    fireEvent.change(screen.getByLabelText("名称", { exact: true }), { target: { value: "未保存中转" } });
    await act(async () => pending.resolve(summaryFixture()));
    fireEvent.click(screen.getByRole("button", { name: "用户与清理" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 与权限" }));
    expect(screen.getByLabelText("内置提供商")).toHaveValue("deepseek");
    expect(screen.getByLabelText("名称", { exact: true })).toHaveValue("未保存中转");
  });

  it("刷新相同用户的权限不会覆盖未保存的备注与角色", async () => {
    getAdminSummaryMock.mockImplementation(async () => ({ ...summaryFixture(), users: [userFixture()] }));
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("原备注"));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "尚未保存的备注" } });
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).not.toBeDisabled());
    expect(screen.getByLabelText("备注")).toHaveValue("尚未保存的备注");
    expect(screen.getByLabelText("角色")).toHaveValue("admin");
  });

  it("中转站保存期间继续编辑时保留新输入并沿用保存后的ID", async () => {
    const pending = deferred<AdminAiRelay>();
    saveAdminAiRelayMock.mockReturnValueOnce(pending.promise);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.click(screen.getByRole("button", { name: "新增中转站" }));
    fireEvent.change(screen.getByLabelText("名称", { exact: true }), { target: { value: "第一次名称" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-only-key" } });
    fireEvent.click(screen.getByRole("button", { name: "安全保存" }));
    fireEvent.change(screen.getByLabelText("名称", { exact: true }), { target: { value: "第二次名称" } });
    await act(async () => pending.resolve({ id: "saved-relay", name: "第一次名称" } as AdminAiRelay));
    expect(screen.getByLabelText("名称", { exact: true })).toHaveValue("第二次名称");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    saveAdminAiRelayMock.mockResolvedValueOnce({ id: "saved-relay", name: "第二次名称" });
    fireEvent.click(screen.getByRole("button", { name: "安全保存" }));
    await waitFor(() => expect(saveAdminAiRelayMock).toHaveBeenCalledTimes(2));
    expect(saveAdminAiRelayMock.mock.calls[1][0]).toEqual(expect.objectContaining({ id: "saved-relay", name: "第二次名称", apiKey: "" }));
  });

  it("旧中转站保存完成不会关闭后来打开的新草稿", async () => {
    const pending = deferred<AdminAiRelay>();
    saveAdminAiRelayMock.mockReturnValueOnce(pending.promise);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("内置提供商")).toHaveValue("mimo"));
    fireEvent.click(screen.getByRole("button", { name: "新增中转站" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-only-key" } });
    fireEvent.click(screen.getByRole("button", { name: "安全保存" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭中转站编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "新增中转站" }));
    fireEvent.change(screen.getByLabelText("名称", { exact: true }), { target: { value: "新的草稿" } });
    await act(async () => pending.resolve({ id: "saved-relay", name: "旧草稿" } as AdminAiRelay));
    expect(screen.getByLabelText("名称", { exact: true })).toHaveValue("新的草稿");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "新增时必填");
  });

  it("删除已引用的中转站只回退对应路由，不丢弃其他配置草稿", async () => {
    const current = summaryFixture();
    current.aiSettings.text_relay_id = "relay";
    current.aiRelays = [{
      id: "relay", name: "待删除中转", protocol: "openai_compatible", baseUrl: "https://relay.example/v1",
      keyConfigured: true, supportsText: true, textModel: "test-model", supportsAudio: false, audioModel: null,
      lastTestedAt: null, lastTestStatus: null, lastTestMessage: null, lastTestLatencyMs: null, createdAt: null, updatedAt: null
    }];
    getAdminSummaryMock.mockResolvedValueOnce(current).mockResolvedValue(summaryFixture());
    deleteAdminAiRelayMock.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("文本路由")).toHaveValue("relay"));
    fireEvent.change(screen.getByLabelText("AI 助手普通用户每日额度"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText(/待删除中转.*已删除/);
    expect(screen.getByLabelText("文本路由")).toHaveValue("");
    expect(screen.getByLabelText("AI 助手普通用户每日额度")).toHaveValue(7);
  });

  it("权限保存期间的新备注与新邮箱不会被保存回调清空", async () => {
    const pending = deferred<{ aiAccess: AdminUserSummary["aiAccess"] }>();
    getAdminSummaryMock.mockImplementation(async () => ({ ...summaryFixture(), users: [userFixture()] }));
    saveAdminAiAccessMock.mockReturnValueOnce(pending.promise);
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("原备注"));
    fireEvent.change(screen.getByLabelText("邮箱", { exact: true }), { target: { value: "first@example.test" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "已提交的备注" } });
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));
    fireEvent.change(screen.getByLabelText("邮箱", { exact: true }), { target: { value: "next@example.test" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "新备注" } });
    await act(async () => pending.resolve({ aiAccess: userFixture().aiAccess }));
    expect(saveAdminAiAccessMock).toHaveBeenCalledWith(expect.objectContaining({ targetEmail: "first@example.test", note: "已提交的备注" }));
    expect(screen.getByLabelText("邮箱", { exact: true })).toHaveValue("next@example.test");
    expect(screen.getByLabelText("备注")).toHaveValue("新备注");
  });

  it("未修改的权限随刷新更新，切换用户不复用上一用户的草稿", async () => {
    const second = { ...userFixture(), id: "user-two", username: "第二用户", email: "second@example.test",
      aiAccess: { ...userFixture().aiAccess!, user_id: "user-two", note: "第二用户备注" } };
    getAdminSummaryMock.mockResolvedValueOnce({ ...summaryFixture(), users: [userFixture(), second] });
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("原备注"));
    const refreshed = { ...userFixture(), aiAccess: { ...userFixture().aiAccess!, note: "服务器新备注" } };
    getAdminSummaryMock.mockResolvedValueOnce({ ...summaryFixture(), users: [refreshed, second] });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("服务器新备注"));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "第一用户草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "用户与清理" }));
    fireEvent.click(screen.getByRole("button", { name: /第二用户 second@example.test/ }));
    expect(screen.getByLabelText("备注")).toHaveValue("第二用户备注");
  });

  it.each([false, true])("重新选择同一用户会退出邮箱授权并重建该用户草稿（迟到详情：%s）", async (withLateDetails) => {
    const pendingDetails = deferred<AdminUserDetails>();
    const user = userFixture();
    getAdminSummaryMock.mockResolvedValue({ ...summaryFixture(), users: [user] });
    getAdminUserDetailsMock.mockReturnValue(pendingDetails.promise);
    saveAdminAiAccessMock.mockResolvedValue({ aiAccess: user.aiAccess });
    render(<AdminDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("原备注"));
    if (withLateDetails) {
      fireEvent.click(screen.getByRole("button", { name: "用户与清理" }));
      fireEvent.click(screen.getByRole("button", { name: "查看数据" }));
      fireEvent.click(screen.getByRole("button", { name: "AI 与权限" }));
    }
    fireEvent.change(screen.getByLabelText("邮箱", { exact: true }), { target: { value: "another@example.test" } });
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "仅授予邮箱目标的权限" } });
    fireEvent.click(screen.getByRole("button", { name: "用户与清理" }));
    fireEvent.click(screen.getByRole("button", { name: /测试用户 user@example.test/ }));
    if (withLateDetails) {
      await act(async () => pendingDetails.resolve({
        passwordVisible: false, user, aiAccess: { ...user.aiAccess!, role: "admin", note: "迟到详情" }, aiUsage: user.aiUsage,
        data: { semesters: [], courses: [], events: [], anniversaries: [], memos: [], focusSessions: [] }
      }));
    }
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(saveAdminAiAccessMock).toHaveBeenCalledWith({
      targetUserId: "user-one", targetEmail: undefined, enabled: true,
      role: "member", expiresAt: null, note: "原备注"
    }));
    expect(screen.getByLabelText("角色")).toHaveValue("member");
    expect(screen.getByLabelText("备注")).toHaveValue("原备注");
    if (withLateDetails) expect(screen.getByRole("button", { name: "查看数据" })).toBeInTheDocument();
  });

});

function summaryFixture(): AdminSummary {
  return {
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
        model: "mimo-v2.6-flash",
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
    };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function userFixture(): AdminUserSummary {
  const period = { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, estimatedCostCny: null };
  return {
    id: "user-one", username: "测试用户", email: "user@example.test", bannedUntil: null,
    createdAt: null, lastSignInAt: null, confirmedAt: null,
    counts: { semesters: 0, courses: 0, events: 0, habits: 0, anniversaries: 0, memos: 0, focusSessions: 0 },
    aiAccess: { user_id: "user-one", enabled: true, role: "member", expires_at: null, note: "原备注" },
    aiUsage: { ...period, errorCount: 0, promptTokens: 0, completionTokens: 0, lastUsedAt: null, today: period, month: period }
  };
}
