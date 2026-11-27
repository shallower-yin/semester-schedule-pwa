import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyOtpEntry as entry, legacyOtpPassword as password, legacyOtpRecord } from "../test/otpLegacyFixture";
import { setCurrentUserId } from "./identity";
import { detectOtpEntry, OtpVault, validateOtpEnvelope, type OtpTransport, type OtpVaultRecord } from "./otpVault";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { localStorage.clear(); setCurrentUserId("alice"); });
const token = { kind: "secret" as const, issuer: "API", account: "开发", secret: "  sk-Test_09/AbC+=token  " };

function storage(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, clear: () => map.clear(), getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); }, key: index => [...map.keys()][index] ?? null };
}
function cloud() {
  const state = { row: null as OtpVaultRecord | null, offline: false, collisions: false };
  const transport: OtpTransport = {
    read: vi.fn(async () => { if (state.offline) throw new Error("offline"); return structuredClone(state.row); }),
    write: vi.fn(async (ownerId, revision, payload) => {
      if (state.offline) throw new Error("offline");
      if ((state.row?.revision ?? 0) !== revision || state.collisions) return null;
      state.row = { user_id: ownerId, revision: revision + 1, payload: structuredClone(payload), updated_at: new Date().toISOString() };
      return structuredClone(state.row);
    })
  };
  return { state, transport };
}
async function anotherDevice(transport: OtpTransport, device = storage()) {
  const vault = new OtpVault("alice", { storage: device, transport });
  await vault.load();
  return vault;
}
async function createFixture() {
  const server = cloud(), device = storage();
  const vault = await anotherDevice(server.transport, device);
  await vault.save(entry, "first");
  await vault.sync();
  return { ...server, device, vault };
}
async function legacyFixture() {
  const server = cloud(), device = storage();
  server.state.row = await legacyOtpRecord();
  device.setItem("semester-schedule-otp-vault:alice", JSON.stringify({ version: 1, base: server.state.row, pending: null }));
  const vault = await anotherDevice(server.transport, device);
  return { ...server, device, vault };
}

describe("密钥自动识别与免密码同步", () => {
  it("自动识别 Base32 和 otpauth，普通令牌保留原文，不把损坏的 otpauth 当普通令牌", () => {
    expect(detectOtpEntry(entry)).toMatchObject({ kind: "totp", secret: entry.secret });
    expect(detectOtpEntry({ ...entry, secret: "jbsw y3dp-ehpk3pxp" })).toMatchObject({ kind: "totp", secret: entry.secret });
    expect(detectOtpEntry({ ...entry, issuer: "", account: "", secret: "otpauth://totp/Example%3Auser?secret=JBSWY3DPEHPK3PXP&issuer=Example" })).toMatchObject({ kind: "totp", issuer: "Example", account: "user" });
    expect(detectOtpEntry({ ...entry, ...token })).toEqual(token);
    expect(() => detectOtpEntry({ ...entry, secret: "otpauth://totp/broken?secret=invalid!" })).toThrow();
  });
  it("首次打开直接可用，不创建密码；同步、关闭、另一设备打开均无需密码", async () => {
    const { vault, state, device, transport } = await createFixture();
    await vault.save(token, "token");
    await vault.sync();
    expect(state.row!.payload.version).toBe(2);
    const second = await anotherDevice(transport);
    expect(second.unlocked).toBe(true);
    expect(second.accounts).toEqual(vault.accounts);
    expect(second.accounts.find(item => item.id === "token")!.secret).toBe(token.secret);
    vault.lock();
    expect(vault.accounts).toEqual([]);
    const reopened = await anotherDevice(transport, device);
    expect(reopened.accounts).toEqual(second.accounts);
  });
  it("错误密码不更改旧数据，输入原密码迁移一次后免密码打开并同步", async () => {
    const { vault, state, device, transport } = await legacyFixture();
    expect(vault.unlocked).toBe(false);
    const before = device.getItem("semester-schedule-otp-vault:alice");
    await expect(vault.migrate("wrong password")).rejects.toThrow("原解锁密码不正确");
    expect(device.getItem("semester-schedule-otp-vault:alice")).toBe(before);
    expect(state.row!.payload.version).toBe(1);
    await vault.migrate(password);
    expect(vault.accounts[0]).toMatchObject(entry);
    expect(vault.pending).toBe(true);
    await vault.sync();
    expect(state.row!.payload.version).toBe(2);
    expect(device.getItem("semester-schedule-otp-vault:alice")).not.toContain('"legacy"');
    expect(device.getItem("semester-schedule-otp-vault:alice")).not.toContain(password);
    const second = await anotherDevice(transport);
    expect(second.accounts).toEqual(vault.accounts);
  });
  it("离线迁移后重开仍无需密码，联网可读取旧云端快照并完成转换", async () => {
    const { vault, state, device, transport } = await legacyFixture();
    state.offline = true;
    await vault.migrate(password);
    await vault.save(token, "token");
    vault.lock();
    const reopened = await anotherDevice(transport, device);
    expect(reopened.unlocked).toBe(true);
    expect(reopened.accounts).toHaveLength(2);
    state.offline = false;
    await reopened.sync();
    expect(state.row!.payload.version).toBe(2);
    expect(reopened.pending).toBe(false);
    expect(reopened.accounts).toHaveLength(2);
  });
  it("忘记密码重新开始前保留旧密文，旧备份仍可在找回原密码后导入", async () => {
    const { vault, state, device, transport } = await legacyFixture();
    const backup = vault.exportBackup();
    const original = structuredClone(state.row);
    await vault.startOver();
    expect(state.row).toEqual(original);
    const archives = Array.from({ length: device.length }, (_, i) => device.key(i)!).filter(key => key.includes(":recovery:"));
    expect(archives).toHaveLength(1);
    expect(device.getItem(archives[0])).toContain(original!.payload.version === 1 ? original!.payload.ciphertext : "unreachable");
    await vault.save(token, "new-token");
    await vault.sync();
    expect(state.row!.payload.version).toBe(2);
    expect(vault.accounts).toHaveLength(1);
    const second = await anotherDevice(transport);
    expect(second.unlocked).toBe(true);
    expect(await second.importBackup(backup, password)).toBe(1);
    expect(second.accounts.map(item => item.issuer)).toEqual(expect.arrayContaining(["API", "GitHub"]));
  });
  it("旧备份无法保存时不重新开始，云端旧快照已变化时不覆盖新内容", async () => {
    const { vault, state, device, transport } = await legacyFixture();
    const original = device.setItem;
    device.setItem = () => { throw new Error("quota"); };
    await expect(vault.startOver()).rejects.toThrow("旧数据未更改");
    expect(vault.unlocked).toBe(false);
    expect(state.row!.payload.version).toBe(1);
    device.setItem = original;
    await vault.startOver();
    await vault.save(token);
    state.row = await legacyOtpRecord("alice", 2, { ...entry, issuer: "其他设备的新密钥" });
    await expect(vault.sync()).rejects.toThrow("旧版加密数据");
    expect(state.row.revision).toBe(2);
    expect(vault.pending).toBe(true);
    expect(transport.write).not.toHaveBeenCalled();
  });
  it("离线修改持久保存，联网后合并其他设备新增记录", async () => {
    const { vault, state, device, transport } = await createFixture();
    const second = await anotherDevice(transport);
    state.offline = true;
    vault.lock();
    const offline = new OtpVault("alice", { storage: device, transport });
    expect(await offline.load()).toMatchObject({ offline: true });
    expect(offline.unlocked).toBe(true);
    await offline.save(token, "local-new");
    await expect(offline.sync()).rejects.toThrow("offline");
    expect(offline.pending).toBe(true);
    state.offline = false;
    await second.save({ ...entry, issuer: "另一台设备新增" }, "remote-new");
    await second.sync();
    await offline.sync();
    expect(offline.accounts.map(item => item.issuer)).toEqual(expect.arrayContaining(["GitHub", "API", "另一台设备新增"]));
    expect(offline.pending).toBe(false);
  });
  it("同一条记录同时修改时保留两个版本，删除不会吞掉并发编辑", async () => {
    const { vault, transport } = await createFixture();
    const second = await anotherDevice(transport);
    await vault.save(token, "first");
    await second.save({ ...entry, issuer: "设备 B", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }, "first");
    await vault.sync();
    expect(await second.sync()).toEqual({ conflicts: 1 });
    expect(second.accounts).toHaveLength(2);
    expect(new Set(second.accounts.map(item => item.secret)).size).toBe(2);
    await vault.sync();
    const third = await anotherDevice(transport);
    await vault.remove("first");
    await third.save({ ...entry, issuer: "删除时仍在编辑" }, "first");
    await vault.sync();
    expect((await third.sync()).conflicts).toBe(1);
    expect(third.accounts.some(item => item.issuer === "删除时仍在编辑")).toBe(true);
  });
  it("备份同时恢复令牌和 2FA，只合并不覆盖，并正确传播删除", async () => {
    const { vault, transport } = await createFixture();
    await vault.save(token, "token");
    const backup = vault.exportBackup();
    expect(JSON.parse(backup).version).toBe(2);
    expect(await vault.importBackup(backup)).toBe(0);
    await vault.remove("first");
    await vault.sync();
    const follower = await anotherDevice(transport);
    expect(follower.accounts.map(item => item.issuer)).toEqual(["API"]);
    expect(await vault.importBackup(backup)).toBe(1);
    expect(vault.accounts).toHaveLength(2);
    const restored = await anotherDevice(cloud().transport);
    expect(await restored.importBackup(vault.exportBackup())).toBe(2);
  });
  it("账号错配、导入他人备份、延迟迁移和延迟云端读取均不能跨账号泄露数据", async () => {
    const { vault, transport } = await legacyFixture();
    const backup = vault.exportBackup();
    const pendingMigration = vault.migrate(password);
    vault.lock();
    await expect(pendingMigration).rejects.toThrow("账号已变化");
    expect(vault.accounts).toEqual([]);
    setCurrentUserId("bob");
    const bob = new OtpVault("bob", { storage: storage(), transport: cloud().transport });
    await bob.load();
    await expect(bob.importBackup(backup, password)).rejects.toThrow("当前账号");
    await expect(vault.save(token)).rejects.toThrow("账号已变化");
    const mismatched = new OtpVault("bob", { storage: storage(), transport });
    await expect(mismatched.load()).rejects.toThrow("云端密钥记录无效");
    setCurrentUserId("alice");
    let release!: (value: OtpVaultRecord | null) => void;
    const delayed = new OtpVault("alice", { storage: storage(), transport: { ...transport, read: () => new Promise(resolve => { release = resolve; }) } });
    const pendingLoad = delayed.load();
    delayed.lock();
    release(null);
    await expect(pendingLoad).rejects.toThrow("账号已变化");
    expect(delayed.unlocked).toBe(false);
  });
  it("修订号冲突只有限重试并保留待上传数据", async () => {
    const { vault, state, transport } = await createFixture();
    await vault.save(token, "second");
    state.collisions = true;
    vi.mocked(transport.write).mockClear();
    await expect(vault.sync()).rejects.toThrow("本机");
    expect(transport.write).toHaveBeenCalledTimes(2);
    expect(vault.pending).toBe(true);
    state.collisions = false;
    await vault.sync();
    expect(vault.pending).toBe(false);
    expect(vault.accounts).toHaveLength(2);
  });
  it("并发窗口共享缓存，不丢失彼此新增的密钥", async () => {
    const { vault, device, transport } = await createFixture();
    const second = await anotherDevice(transport, device);
    await Promise.all([vault.save({ ...token, issuer: "窗口 A" }, "window-a"), second.save({ ...entry, issuer: "窗口 B" }, "window-b")]);
    await second.sync();
    expect(second.accounts).toHaveLength(3);
  });
  it("存储失败不宣称保存成功，损坏的云端记录不覆盖已保存缓存", async () => {
    const { vault, device, state, transport } = await createFixture();
    const saved = device.setItem;
    device.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    await expect(vault.save(token)).rejects.toThrow("尚未保存");
    expect(vault.accounts).toHaveLength(1);
    device.setItem = saved;
    const lastGood = device.getItem("semester-schedule-otp-vault:alice");
    state.row!.payload = { version: 2, items: [{ id: "broken" }] } as never;
    const reopened = await anotherDevice(transport, device);
    expect(reopened.accounts).toHaveLength(1);
    expect(device.getItem("semester-schedule-otp-vault:alice")).toBe(lastGood);
  });
  it("旧密文篡改不覆盖已验证的本机副本，拒绝无界的密码推导成本", async () => {
    const { vault, state, device, transport } = await legacyFixture();
    const lastGoodBackup = vault.exportBackup();
    const payload = state.row!.payload;
    if (payload.version !== 1) throw new Error("expected legacy");
    payload.ciphertext = (payload.ciphertext[0] === "A" ? "B" : "A") + payload.ciphertext.slice(1);
    const reopened = await anotherDevice(transport, device);
    await expect(reopened.migrate(password)).rejects.toThrow("原解锁密码不正确");
    expect(reopened.exportBackup()).toBe(lastGoodBackup);
    expect(() => validateOtpEnvelope({ ...payload, iterations: 2_000_000_000 })).toThrow();
    expect(() => validateOtpEnvelope({ ...payload, iv: "short" })).toThrow();
  });
});
