import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentUserId } from "./identity";
import { OtpVault, validateOtpEnvelope, type OtpTransport, type OtpVaultRecord } from "./otpVault";
import type { OtpParameters } from "./totp";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { localStorage.clear(); setCurrentUserId("alice"); });
const password = "correct horse battery staple";
const entry: OtpParameters = { issuer: "GitHub", account: "test@example.invalid", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 };

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
async function createFixture() {
  const server = cloud();
  const device = storage();
  const vault = new OtpVault("alice", { storage: device, transport: server.transport });
  await vault.load();
  await vault.create(password);
  await vault.save(entry, "first");
  await vault.sync();
  return { ...server, device, vault };
}
async function anotherDevice(transport: OtpTransport, device = storage()) {
  const vault = new OtpVault("alice", { storage: device, transport });
  await vault.load();
  await vault.unlock(password);
  return vault;
}

describe("身份验证器加密与同步", () => {
  it("服务器和本机缓存仅含密文，另一台设备使用独立密码解锁", async () => {
    const { vault, state, device, transport } = await createFixture();
    const raw = JSON.stringify(state.row) + device.getItem(device.key(0)!);
    for (const privateValue of [password, entry.secret, entry.account, entry.issuer]) expect(raw).not.toContain(privateValue);
    const second = await anotherDevice(transport);
    expect(second.accounts).toEqual(vault.accounts);
    expect(second.pending).toBe(false);
    vault.lock();
    expect(vault.accounts).toEqual([]);
    expect(vault.unlocked).toBe(false);
    await vault.unlock(password);
    expect(vault.accounts).toHaveLength(1);
  });
  it("密码错误、密文篡改和账号错配均不能读取密钥", async () => {
    const { vault, state, device, transport } = await createFixture();
    vault.lock();
    await expect(vault.unlock("wrong password")).rejects.toThrow("解锁密码不正确");
    const lastGoodBackup = vault.exportBackup();
    const encrypted = state.row!.payload.ciphertext;
    state.row!.payload.ciphertext = (encrypted[0] === "A" ? "B" : "A") + encrypted.slice(1);
    const reopened = new OtpVault("alice", { storage: device, transport });
    await reopened.load();
    await expect(reopened.unlock(password)).rejects.toThrow("解锁密码不正确");
    expect(reopened.exportBackup()).toBe(lastGoodBackup);
    setCurrentUserId("bob");
    await expect(vault.unlock(password)).rejects.toThrow("已锁定");
    const bob = new OtpVault("bob", { storage: storage(), transport: cloud().transport });
    await bob.load();
    await expect(bob.importBackup(lastGoodBackup, password)).rejects.toThrow("当前账号");
  });
  it("离线修改可持久保存，恢复联网后合并其他设备新增账号", async () => {
    const { vault, state, device, transport } = await createFixture();
    const second = await anotherDevice(transport);
    state.offline = true;
    vault.lock();
    const offline = new OtpVault("alice", { storage: device, transport });
    expect(await offline.load()).toMatchObject({ offline: true });
    await offline.unlock(password);
    await offline.save({ ...entry, issuer: "本机新增" }, "local-new");
    await expect(offline.sync()).rejects.toThrow("offline");
    expect(offline.pending).toBe(true);
    state.offline = false;
    await second.save({ ...entry, issuer: "另一台设备新增" }, "remote-new");
    await second.sync();
    await offline.sync();
    expect(offline.accounts.map(item => item.issuer)).toEqual(expect.arrayContaining(["GitHub", "本机新增", "另一台设备新增"]));
    expect(offline.pending).toBe(false);
    await offline.save({ ...entry, issuer: "同步后的本机修改" }, "local-new");
    await offline.sync();
    offline.lock();
    await offline.unlock(password);
    expect(offline.accounts.some(item => item.issuer === "同步后的本机修改")).toBe(true);
  });
  it("同一条记录同时修改时保留两个版本，删除不会吞掉并发编辑", async () => {
    const { vault, transport } = await createFixture();
    const second = await anotherDevice(transport);
    await vault.save({ ...entry, issuer: "设备 A" }, "first");
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
  it("删除后的加密备份不再含有活跃账号，导入只合并且不覆盖当前记录", async () => {
    const { vault, transport } = await createFixture();
    const backup = vault.exportBackup();
    await vault.save({ ...entry, issuer: "保留本机账号" }, "second");
    expect(await vault.importBackup(backup, password)).toBe(0);
    await vault.remove("first");
    await vault.sync();
    expect(await vault.importBackup(backup, password)).toBe(1);
    expect(vault.accounts.map(item => item.issuer)).toEqual(expect.arrayContaining(["GitHub", "保留本机账号"]));
    const restored = new OtpVault("alice", { storage: storage(), transport: cloud().transport });
    await restored.load();
    expect(await restored.importBackup(vault.exportBackup(), password)).toBe(2);
    await restored.sync();
    expect(restored.accounts).toHaveLength(2);
    const follower = await anotherDevice(transport);
    expect(follower.accounts.map(item => item.issuer)).toEqual(["保留本机账号"]);
  });
  it("锁定或账号切换后，延迟的解锁操作不能重新暴露数据", async () => {
    const { vault } = await createFixture();
    vault.lock();
    const pendingUnlock = vault.unlock(password);
    vault.lock();
    await expect(pendingUnlock).rejects.toThrow("已锁定");
    expect(vault.accounts).toEqual([]);
    expect(vault.unlocked).toBe(false);
  });
  it("修订号冲突会有限重试并保留待上传数据", async () => {
    const { vault, state } = await createFixture();
    await vault.save({ ...entry, issuer: "等待同步" }, "second");
    state.collisions = true;
    await expect(vault.sync()).rejects.toThrow("本机");
    expect(vault.pending).toBe(true);
    state.collisions = false;
    await vault.sync();
    expect(vault.pending).toBe(false);
    expect(vault.accounts).toHaveLength(2);
  });
  it("并发窗口修改同一个加密缓存时不会丢失另一窗口新增的记录", async () => {
    const { vault, device, transport } = await createFixture();
    const second = await anotherDevice(transport, device);
    await Promise.all([
      vault.save({ ...entry, issuer: "窗口 A" }, "window-a"),
      second.save({ ...entry, issuer: "窗口 B" }, "window-b")
    ]);
    await second.sync();
    expect(second.accounts).toHaveLength(3);
  });
  it("存储失败不会宣称保存成功；不同云端密码不会覆盖本机待上传数据", async () => {
    const { vault, device, state } = await createFixture();
    const saved = device.setItem;
    device.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    await expect(vault.save({ ...entry, issuer: "不可写" }, "second")).rejects.toThrow("尚未保存");
    expect(vault.accounts).toHaveLength(1);
    device.setItem = saved;
    await vault.save({ ...entry, issuer: "本机待上传" }, "second");
    state.row!.payload.salt = btoa("different-salt16");
    await expect(vault.sync()).rejects.toThrow("密码与本机不同");
    expect(vault.pending).toBe(true);
    expect(vault.accounts).toHaveLength(2);
  });
  it("拒绝未知加密参数，防止导入文件指定无界的密码推导成本", async () => {
    const { vault, state } = await createFixture();
    expect(() => validateOtpEnvelope({ ...state.row!.payload, iterations: 2_000_000_000 })).toThrow();
    expect(() => validateOtpEnvelope({ ...state.row!.payload, iv: "short" })).toThrow();
    await expect(vault.importBackup(JSON.stringify({ format: "wrong" }), password)).rejects.toThrow();
  });
});
