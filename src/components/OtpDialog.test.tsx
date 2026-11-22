import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentUserId } from "../lib/identity";
import { exportText } from "../lib/fileExport";
import { OtpVault, otpCloudTransport, type OtpVaultRecord } from "../lib/otpVault";
import { generateTotp } from "../lib/totp";
import { OtpDialog } from "./OtpDialog";

vi.mock("../lib/fileExport", () => ({ exportText: vi.fn(async () => ({ saved: true })) }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
const rows = new Map<string, OtpVaultRecord>();
const password = "correct horse battery staple";
const parameters = { issuer: "GitHub", account: "otp-test@example.invalid", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1" as const, digits: 6 as const, period: 30 };
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
  await vault.load(); await vault.create(password); await vault.save(parameters); await vault.sync(); vault.lock();
}
function open(ownerId = "alice") { return render(<OtpDialog ownerId={ownerId} onClose={vi.fn()} onSignIn={vi.fn()} />); }
async function unlock() {
  fireEvent.change(await screen.findByLabelText("解锁密码", { exact: true }), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
  const copy = await screen.findByRole("button", { name: "复制 GitHub · otp-test@example.invalid 验证码" });
  await waitFor(() => expect(copy).toBeEnabled());
  return copy;
}

describe("身份验证器界面", () => {
  it("未登录时提供登录入口，不请求或暴露其他账号的验证码", () => {
    const signIn = vi.fn();
    render(<OtpDialog ownerId="local" onClose={vi.fn()} onSignIn={signIn} />);
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(otpCloudTransport.read).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("解锁密码", { exact: true })).not.toBeInTheDocument();
  });
  it("创建时检查两次密码，保存后只向云端发送加密数据", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("解锁密码", { exact: true }), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("确认解锁密码"), { target: { value: "different password" } });
    fireEvent.click(screen.getByRole("button", { name: "创建身份验证器" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("两次密码不一致");
    expect(otpCloudTransport.write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("确认解锁密码"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "创建身份验证器" }));
    expect(await screen.findByRole("button", { name: "添加账号" })).toBeInTheDocument();
    await waitFor(() => expect(rows.size).toBe(1));
    expect(JSON.stringify([...rows.values()])).not.toContain(password);
  });
  it("解锁后可以复制动态验证码，且不影响原始密钥的展示", async () => {
    await seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T12:00:10+08:00"));
    open();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    const copy = await unlock();
    fireEvent.click(copy);
    await waitFor(() => expect(clipboard).toHaveBeenCalled());
    expect(clipboard).toHaveBeenCalledWith(await generateTotp(parameters));
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 原始密钥")).toHaveTextContent(parameters.secret);
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 剩余有效期")).toHaveTextContent(/^\d+ 秒$/);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("原始密钥", { exact: true })).not.toBeInTheDocument();
  });
  it("本人解锁后明文显示并复制原始密钥，本机和云端仍仅保存密文", async () => {
    await seed(); open();
    await screen.findByRole("button", { name: "解锁" });
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(screen.queryByRole("button", { name: /复制.*原始密钥/ })).not.toBeInTheDocument();
    await unlock();
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 原始密钥")).toHaveTextContent(parameters.secret);
    fireEvent.click(screen.getByRole("button", { name: "复制 GitHub · otp-test@example.invalid 原始密钥" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(parameters.secret));
    expect(JSON.stringify([...rows.values()])).not.toContain(parameters.secret);
    const rawCache = Object.keys(localStorage).filter(key => key.startsWith("semester-schedule-otp-vault:")).map(key => localStorage.getItem(key)).join("");
    expect(rawCache).not.toContain(parameters.secret);
    fireEvent.click(screen.getByRole("button", { name: "锁定身份验证器" }));
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(screen.queryByRole("button", { name: /复制.*原始密钥/ })).not.toBeInTheDocument();
  });
  it("切换账号后清除已显示的原始密钥和复制入口", async () => {
    await seed();
    const view = open();
    await unlock();
    expect(screen.getByLabelText("GitHub · otp-test@example.invalid 原始密钥")).toHaveTextContent(parameters.secret);
    setCurrentUserId("bob");
    view.rerender(<OtpDialog key="bob" ownerId="bob" onClose={vi.fn()} onSignIn={vi.fn()} />);
    await screen.findByRole("button", { name: "创建身份验证器" });
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(screen.queryByRole("button", { name: /复制.*原始密钥/ })).not.toBeInTheDocument();
    expect(clipboard).not.toHaveBeenCalled();
  });
  it("账号标识已变化但旧界面尚未刷新时，拒绝复制旧账号原始密钥", async () => {
    await seed(); open(); await unlock();
    const copy = screen.getByRole("button", { name: "复制 GitHub · otp-test@example.invalid 原始密钥" });
    setCurrentUserId("bob");
    fireEvent.click(copy);
    expect(clipboard).not.toHaveBeenCalled();
  });
  it("切到后台时清除验证码和正在编辑的密钥，再次查看必须解锁", async () => {
    await seed(); open(); await unlock();
    fireEvent.click(screen.getByRole("button", { name: "添加账号" }));
    fireEvent.change(screen.getByLabelText("密钥或 otpauth 链接"), { target: { value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("button", { name: "解锁" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /复制 GitHub/ })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(parameters.secret);
    expect(document.body.innerHTML).not.toContain("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(document.body.textContent).not.toContain(parameters.account);
  });
  it("锁定状态可以导出密文备份，普通日程备份不参与此流程", async () => {
    await seed(); open();
    await screen.findByRole("button", { name: "解锁" });
    fireEvent.click(screen.getByText("备份与恢复"));
    fireEvent.click(screen.getByRole("button", { name: "导出加密备份" }));
    await waitFor(() => expect(exportText).toHaveBeenCalled());
    const serialized = vi.mocked(exportText).mock.calls.at(-1)![0];
    expect(JSON.parse(serialized).format).toBe("semester-schedule-otp-backup");
    expect(serialized).not.toContain(parameters.secret);
    expect(serialized).not.toContain(parameters.account);
  });
  it("切换账号时，旧账号的异步解锁不能在新账号界面复现", async () => {
    await seed();
    const view = open();
    fireEvent.change(await screen.findByLabelText("解锁密码", { exact: true }), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));
    setCurrentUserId("bob");
    view.rerender(<OtpDialog key="bob" ownerId="bob" onClose={vi.fn()} onSignIn={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "创建身份验证器" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(parameters.account);
    expect(screen.queryByRole("button", { name: /复制 GitHub/ })).not.toBeInTheDocument();
  });
  it("云端不可用且没有缓存时阻止创建，重试后可继续", async () => {
    vi.mocked(otpCloudTransport.read).mockRejectedValue(new Error("数据库更新尚未部署"));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("数据库更新尚未部署");
    expect(screen.queryByRole("button", { name: "创建身份验证器" })).not.toBeInTheDocument();
    vi.mocked(otpCloudTransport.read).mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByRole("button", { name: "创建身份验证器" })).toBeInTheDocument();
  });
  it("图片选择器返回时若已自动锁定，保留所选文件并等待重新解锁再读取", async () => {
    const decode = vi.fn(async () => { throw new Error("模拟二维码读取"); });
    vi.stubGlobal("createImageBitmap", decode);
    await seed(); open(); await unlock();
    fireEvent.click(screen.getByRole("button", { name: "添加账号" }));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    fireEvent.change(screen.getByLabelText("选择单个验证账号二维码"), { target: { files: [new File(["fixture"], "qr.png", { type: "image/png" })] } });
    expect(screen.getByText("解锁后继续读取所选二维码。")).toBeInTheDocument();
    expect(decode).not.toHaveBeenCalled();
    await unlock();
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent("模拟二维码读取");
  });
  it("闲置五分钟后自动锁定", async () => {
    await seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    open(); await unlock();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(await screen.findByRole("button", { name: "解锁" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /复制 GitHub/ })).not.toBeInTheDocument();
  });
  it("尚未解锁时切到后台，也会清空输入中的解锁密码", async () => {
    await seed(); open();
    const field = await screen.findByLabelText("解锁密码", { exact: true });
    fireEvent.change(field, { target: { value: password } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(field).toHaveValue("");
    expect(screen.queryByRole("button", { name: /复制 GitHub/ })).not.toBeInTheDocument();
  });
});
