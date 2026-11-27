import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentUserId } from "../lib/identity";
import { exportText } from "../lib/fileExport";
import { OtpVault, otpCloudTransport, type OtpVaultRecord } from "../lib/otpVault";
import { generateTotp } from "../lib/totp";
import { legacyOtpEntry as parameters, legacyOtpPassword as password, legacyOtpRecord } from "../test/otpLegacyFixture";
import { OtpDialog } from "./OtpDialog";

vi.mock("../lib/fileExport", () => ({ exportText: vi.fn(async () => ({ saved: true })) }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
const rows = new Map<string, OtpVaultRecord>();
const token = "sk-TestToken_019/AbC+=test";
const clipboard = vi.fn(async () => {});
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => {
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
beforeEach(() => {
  localStorage.clear(); rows.clear(); clipboard.mockClear();
  vi.mocked(exportText).mockReset().mockResolvedValue({ saved: true });
  setCurrentUserId("alice");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  vi.spyOn(otpCloudTransport, "read").mockImplementation(async owner => structuredClone(rows.get(owner) ?? null));
  vi.spyOn(otpCloudTransport, "write").mockImplementation(async (owner, expected, payload) => {
    if ((rows.get(owner)?.revision ?? 0) !== expected) return null;
    const row = { user_id: owner, revision: expected + 1, payload, updated_at: new Date().toISOString() };
    rows.set(owner, structuredClone(row));
    return row;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function seed() {
  const vault = new OtpVault("alice");
  await vault.load(); await vault.save(parameters); await vault.sync(); vault.lock();
}
function open(ownerId = "alice") { return render(<OtpDialog ownerId={ownerId} onClose={vi.fn()} onSignIn={vi.fn()} />); }
async function codeButton() {
  const copy = await screen.findByRole("button", { name: "复制 GitHub · otp-test@example.invalid 验证码" });
  await waitFor(() => expect(copy).toBeEnabled());
  return copy;
}
async function addKey(issuer: string, value: string) {
  fireEvent.click(await screen.findByRole("button", { name: "添加密钥" }));
  fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: issuer } });
  fireEvent.change(screen.getByLabelText("密钥或令牌"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
  await waitFor(() => expect(screen.queryByLabelText("密钥或令牌")).not.toBeInTheDocument());
}
async function selectBackup(content: string) {
  const file = new File([content], "backup.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => content });
  fireEvent.click(screen.getByText("备份与恢复"));
  fireEvent.change(screen.getByLabelText("选择身份验证器备份"), { target: { files: [file] } });
  await screen.findByRole("button", { name: "合并导入" });
}

describe("身份验证器界面", () => {
  it("未登录时提供登录入口，不请求或暴露其他账号的密钥", () => {
    const signIn = vi.fn();
    render(<OtpDialog ownerId="local" onClose={vi.fn()} onSignIn={signIn} />);
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(otpCloudTransport.read).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("原解锁密码")).not.toBeInTheDocument();
  });
  it("首次打开直接添加密钥，沿用同一个输入框自动识别普通令牌，不显示验证码或类型选择", async () => {
    open();
    expect(await screen.findByRole("button", { name: "添加密钥" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /锁定/ })).not.toBeInTheDocument();
    await addKey("API", token);
    const item = screen.getByLabelText("API 原始密钥").closest("li")!;
    expect(item).toHaveTextContent(token);
    expect(within(item).queryByRole("button", { name: /验证码/ })).not.toBeInTheDocument();
    expect(within(item).queryByText(/秒$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制 API 原始密钥" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(token));
    await waitFor(() => expect(rows.get("alice")?.payload.version).toBe(2));
  });
  it("2FA 和令牌在同一列表共存，2FA 可复制动态验证码和原始密钥", async () => {
    await seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T12:00:10+08:00"));
    open();
    fireEvent.click(await codeButton());
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/)));
    expect(clipboard).toHaveBeenCalledWith(await generateTotp(parameters));
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 原始密钥")).toHaveTextContent(parameters.secret);
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 剩余有效期")).toHaveTextContent(/^\d+ 秒$/);
    fireEvent.click(screen.getByRole("button", { name: "复制 GitHub · otp-test@example.invalid 原始密钥" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(parameters.secret));
    await addKey("API", token);
    expect(await codeButton()).toBeEnabled();
    expect(screen.getByLabelText("API 原始密钥")).toHaveTextContent(token);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("同一输入框支持 otpauth 链接，编辑可在普通令牌与 2FA 之间自动转换", async () => {
    open();
    await addKey("Link", "otpauth://totp/Link?secret=JBSWY3DPEHPK3PXP");
    expect(await screen.findByRole("button", { name: "复制 Link · Link 验证码" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 Link · Link" }));
    fireEvent.change(screen.getByLabelText("密钥或令牌"), { target: { value: token } });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    await waitFor(() => expect(screen.getByLabelText("Link · Link 原始密钥")).toHaveTextContent(token));
    expect(screen.queryByRole("button", { name: "复制 Link · Link 验证码" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 Link · Link" }));
    fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    expect(await screen.findByLabelText("Renamed · Link 原始密钥")).toHaveTextContent(token);
    fireEvent.click(screen.getByRole("button", { name: "编辑 Renamed · Link" }));
    fireEvent.change(screen.getByLabelText("密钥或令牌"), { target: { value: parameters.secret } });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    expect(await screen.findByRole("button", { name: "复制 Renamed · Link 验证码" })).toBeInTheDocument();
  });
  it("已有加密数据只迁移一次，错误密码不更改数据，再打开直接查看", async () => {
    rows.set("alice", await legacyOtpRecord());
    const view = open();
    const field = await screen.findByLabelText("原解锁密码");
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(rows.get("alice")!.payload.version).toBe(1);
    fireEvent.change(field, { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "迁移并打开" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原解锁密码不正确");
    expect(otpCloudTransport.write).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "迁移并打开" }));
    await codeButton();
    await waitFor(() => expect(rows.get("alice")!.payload.version).toBe(2));
    view.unmount(); open(); await codeButton();
    expect(screen.queryByLabelText("原解锁密码")).not.toBeInTheDocument();
  });
  it("忘记密码时先导出旧加密备份，保留副本后重新开始，不声称恢复了旧密钥", async () => {
    rows.set("alice", await legacyOtpRecord());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = open();
    fireEvent.click(await screen.findByRole("button", { name: "保留旧备份并重新开始" }));
    expect(await screen.findByRole("button", { name: "添加密钥" })).toBeInTheDocument();
    const backup = JSON.parse(vi.mocked(exportText).mock.calls[0][0]);
    expect(backup.version).toBe(1);
    expect(JSON.stringify(backup)).not.toContain(parameters.secret);
    expect(Object.keys(localStorage).some(key => key.includes(":recovery:"))).toBe(true);
    await waitFor(() => expect(rows.get("alice")!.payload.version).toBe(2));
    expect(screen.queryByText(parameters.account)).not.toBeInTheDocument();
    view.unmount(); open();
    expect(await screen.findByRole("button", { name: "添加密钥" })).toBeInTheDocument();
    expect(screen.queryByLabelText("原解锁密码")).not.toBeInTheDocument();
  });
  it("取消或导出备份失败时保留旧数据，不重新开始", async () => {
    rows.set("alice", await legacyOtpRecord());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    const reset = await screen.findByRole("button", { name: "保留旧备份并重新开始" });
    fireEvent.click(reset);
    expect(exportText).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    vi.mocked(exportText).mockResolvedValueOnce({ saved: false });
    fireEvent.click(reset);
    await waitFor(() => expect(exportText).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText("原解锁密码")).toBeInTheDocument();
    expect(rows.get("alice")!.payload.version).toBe(1);
    expect(otpCloudTransport.write).not.toHaveBeenCalled();
    vi.mocked(exportText).mockRejectedValueOnce(new Error("导出失败"));
    fireEvent.click(reset);
    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败");
    expect(rows.get("alice")!.payload.version).toBe(1);
  });
  it("切到后台或闲置五分钟后无需解锁，保留正在输入的令牌", async () => {
    await seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    open(); await codeButton();
    fireEvent.click(screen.getByRole("button", { name: "添加密钥" }));
    const field = screen.getByLabelText("密钥或令牌");
    fireEvent.change(field, { target: { value: token } });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await codeButton();
    expect(field).toHaveValue(token);
    expect(screen.queryByLabelText("原解锁密码")).not.toBeInTheDocument();
  });
  it("切换账号后清除旧账号密钥，旧界面还未刷新时也拒绝复制", async () => {
    await seed();
    const view = open(); await codeButton();
    const copy = screen.getByRole("button", { name: "复制 GitHub · otp-test@example.invalid 原始密钥" });
    setCurrentUserId("bob");
    fireEvent.click(copy);
    expect(clipboard).not.toHaveBeenCalled();
    view.rerender(<OtpDialog key="bob" ownerId="bob" onClose={vi.fn()} onSignIn={vi.fn()} />);
    await screen.findByRole("button", { name: "添加密钥" });
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(document.body.textContent).not.toContain(parameters.account);
    expect(screen.queryByRole("button", { name: /复制 GitHub/ })).not.toBeInTheDocument();
  });
  it("账号切换时旧账号的异步迁移不能在新账号界面复现", async () => {
    rows.set("alice", await legacyOtpRecord());
    const view = open();
    fireEvent.change(await screen.findByLabelText("原解锁密码"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "迁移并打开" }));
    setCurrentUserId("bob");
    view.rerender(<OtpDialog key="bob" ownerId="bob" onClose={vi.fn()} onSignIn={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "添加密钥" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(parameters.account);
    expect(rows.get("alice")!.payload.version).toBe(1);
  });
  it("新备份无需密码导入，旧加密备份仍可输入原密码导入", async () => {
    await seed();
    const vault = new OtpVault("alice");
    await vault.load();
    const backup = vault.exportBackup();
    open(); await codeButton();
    await selectBackup(backup);
    expect(screen.queryByLabelText("备份原解锁密码")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "合并导入" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "合并导入" })).not.toBeInTheDocument());
    const legacy = await legacyOtpRecord("alice", 1, { ...parameters, issuer: "旧备份" });
    await selectBackup(JSON.stringify({ format: "semester-schedule-otp-backup", version: 1, ownerId: "alice", payload: legacy.payload }));
    fireEvent.change(screen.getByLabelText("备份原解锁密码"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "合并导入" }));
    expect(await screen.findByLabelText("旧备份 · otp-test@example.invalid 原始密钥")).toHaveTextContent(parameters.secret);
  });
  it("云端不可用且没有缓存时阻止新建覆盖，重试后直接使用", async () => {
    vi.mocked(otpCloudTransport.read).mockRejectedValue(new Error("数据库更新尚未部署"));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("数据库更新尚未部署");
    expect(screen.queryByRole("button", { name: "添加密钥" })).not.toBeInTheDocument();
    vi.mocked(otpCloudTransport.read).mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByRole("button", { name: "添加密钥" })).toBeInTheDocument();
  });
  it("二维码选择器返回时无需重新解锁，直接读取图片", async () => {
    const decode = vi.fn(async () => { throw new Error("模拟二维码读取"); });
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: decode });
    try {
      await seed(); open(); await codeButton();
      fireEvent.click(screen.getByRole("button", { name: "添加密钥" }));
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      fireEvent.change(screen.getByLabelText("选择单个验证账号二维码"), { target: { files: [new File(["fixture"], "qr.png", { type: "image/png" })] } });
      await waitFor(() => expect(decode).toHaveBeenCalledOnce());
      expect(await screen.findByRole("alert")).toHaveTextContent("模拟二维码读取");
      expect(screen.queryByLabelText("原解锁密码")).not.toBeInTheDocument();
    } finally {
      if (originalBitmap) Object.defineProperty(globalThis, "createImageBitmap", originalBitmap);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  });
});
