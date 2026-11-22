import { getCurrentUserId } from "./identity";
import { supabase } from "./supabase";
import { validateOtpParameters, type OtpParameters } from "./totp";

const ITERATIONS = 600_000;
const FORMAT = "semester-schedule-otp-backup";
const MAX_ITEMS = 1000;
export interface OtpAccount extends OtpParameters { id: string; updatedAt: string; deleted?: never }
interface OtpTombstone { id: string; updatedAt: string; deleted: true }
type OtpItem = OtpAccount | OtpTombstone;
interface OtpDocument { version: 1; items: OtpItem[] }
export interface OtpEnvelope {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}
export interface OtpVaultRecord { user_id: string; revision: number; payload: OtpEnvelope; updated_at: string }
interface OtpCache { version: 1; base: OtpVaultRecord | null; pending: OtpEnvelope | null }
export interface OtpTransport {
  read(ownerId: string): Promise<OtpVaultRecord | null>;
  write(ownerId: string, expectedRevision: number, payload: OtpEnvelope): Promise<OtpVaultRecord | null>;
}

const text = new TextEncoder();
const emptyDocument = (): OtpDocument => ({ version: 1, items: [] });
const isAccount = (item: OtpItem): item is OtpAccount => !item.deleted;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const cacheKey = (ownerId: string) => `semester-schedule-otp-vault:${ownerId}`;

function encode(bytes: Uint8Array<ArrayBuffer>): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(""));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new Error("加密数据格式无效。");
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export function validateOtpEnvelope(value: unknown): OtpEnvelope {
  const data = value as OtpEnvelope;
  if (!data || data.version !== 1 || data.kdf !== "PBKDF2-SHA256" || data.iterations !== ITERATIONS
    || typeof data.salt !== "string" || data.salt.length !== 24 || decode(data.salt).length !== 16
    || typeof data.iv !== "string" || data.iv.length !== 16 || decode(data.iv).length !== 12
    || typeof data.ciphertext !== "string" || data.ciphertext.length < 24 || data.ciphertext.length > 1_000_000) {
    throw new Error("加密数据格式无效或版本不支持。");
  }
  decode(data.ciphertext);
  return { version: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: data.salt, iv: data.iv, ciphertext: data.ciphertext };
}

function validateDocument(value: unknown): OtpDocument {
  const document = value as OtpDocument;
  if (document?.version !== 1 || !Array.isArray(document.items) || document.items.length > MAX_ITEMS) throw new Error("验证码数据格式无效。");
  const ids = new Set<string>();
  return { version: 1, items: document.items.map(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)
      || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("验证码记录无效。");
    ids.add(item.id);
    const fields = { id: item.id, updatedAt: item.updatedAt };
    return item.deleted === true ? { ...fields, deleted: true } : { ...fields, ...validateOtpParameters(item as OtpAccount) };
  }) };
}

async function deriveKey(password: string, envelope: Pick<OtpEnvelope, "salt" | "iterations">): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持安全加密，请使用 HTTPS 网页或 Android 安装包。");
  if (!password || password.length > 1024) throw new Error("请输入有效的解锁密码。");
  const material = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: envelope.iterations, salt: decode(envelope.salt) }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encrypt(document: OtpDocument, key: CryptoKey, salt: string, ownerId: string): Promise<OtpEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = text.encode(JSON.stringify(validateDocument(document)));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: text.encode(`semester-schedule-otp:v1:${ownerId}`) }, key, plaintext);
  return validateOtpEnvelope({ version: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(bytes)) });
}

async function decrypt(envelope: OtpEnvelope, key: CryptoKey, ownerId: string): Promise<OtpDocument> {
  try {
    validateOtpEnvelope(envelope);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv), additionalData: text.encode(`semester-schedule-otp:v1:${ownerId}`) }, key, decode(envelope.ciphertext));
    return validateDocument(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { throw new Error("解锁密码不正确，或加密数据已损坏。"); }
}

/** Merge against the last synced snapshot. Concurrent edits never silently discard a seed. */
function merge(base: OtpDocument, local: OtpDocument, remote: OtpDocument): { document: OtpDocument; conflicts: number } {
  const before = new Map(base.items.map(item => [item.id, item]));
  const own = new Map(local.items.map(item => [item.id, item]));
  const other = new Map(remote.items.map(item => [item.id, item]));
  const items: OtpItem[] = [];
  let conflicts = 0;
  for (const id of new Set([...before.keys(), ...own.keys(), ...other.keys()])) {
    const initial = before.get(id), left = own.get(id), right = other.get(id);
    if (same(left, right) || same(right, initial)) { if (left) items.push(left); }
    else if (same(left, initial)) { if (right) items.push(right); }
    else {
      conflicts += 1;
      // Preserve an edited account over a concurrent delete; keep both different edits.
      if (right && isAccount(right)) items.push(right);
      else if (left && isAccount(left)) { items.push(left); continue; }
      else if (right ?? left) { items.push((right ?? left)!); continue; }
      if (left && isAccount(left)) items.push({ ...left, id: crypto.randomUUID(), account: `${left.account.slice(0, 150)}（同步副本）` });
    }
  }
  return { document: validateDocument({ version: 1, items }), conflicts };
}

const localQueues = new Map<string, Promise<unknown>>();
async function exclusive<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) return navigator.locks.request(`otp-vault:${ownerId}`, operation);
  const previous = localQueues.get(ownerId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  localQueues.set(ownerId, next);
  try { return await next; } finally { if (localQueues.get(ownerId) === next) localQueues.delete(ownerId); }
}

export class OtpVault {
  private key: CryptoKey | null = null;
  private document: OtpDocument | null = null;
  private cache: OtpCache = { version: 1, base: null, pending: null };
  private generation = 0;
  private loaded = false;
  private candidate: OtpVaultRecord | null = null;
  private storage: Storage;
  private transport: OtpTransport;
  constructor(readonly ownerId: string, options: { storage?: Storage; transport?: OtpTransport } = {}) {
    this.storage = options.storage ?? localStorage;
    this.transport = options.transport ?? otpCloudTransport;
  }
  get unlocked(): boolean { return Boolean(this.key && this.document); }
  get exists(): boolean { return Boolean(this.cache.pending ?? this.candidate?.payload ?? this.cache.base?.payload); }
  get pending(): boolean { return Boolean(this.cache.pending); }
  get accounts(): OtpAccount[] { return this.document?.items.filter(isAccount).map(item => ({ ...item })) ?? []; }

  private assertCurrent(generation = this.generation): void {
    if (generation !== this.generation || this.ownerId === "local" || getCurrentUserId() !== this.ownerId) throw new Error("身份验证器已锁定，请重新打开。");
  }
  private readCache(): OtpCache {
    const raw = this.storage.getItem(cacheKey(this.ownerId));
    if (!raw) return { version: 1, base: null, pending: null };
    try {
      const value = JSON.parse(raw) as OtpCache;
      if (value.version !== 1 || (value.base && (value.base.user_id !== this.ownerId || !Number.isSafeInteger(value.base.revision) || value.base.revision < 1))) throw new Error();
      if (value.base) value.base.payload = validateOtpEnvelope(value.base.payload);
      if (value.pending) value.pending = validateOtpEnvelope(value.pending);
      return value;
    } catch { throw new Error("本机加密缓存损坏，请保留备份后重试。"); }
  }
  private persist(cache: OtpCache): void {
    try { this.storage.setItem(cacheKey(this.ownerId), JSON.stringify(cache)); }
    catch { throw new Error("无法保存验证码，请检查设备存储空间。本次修改尚未保存。"); }
    this.cache = cache;
    this.candidate = null;
  }
  private async readRemote(): Promise<OtpVaultRecord | null> {
    const remote = await this.transport.read(this.ownerId);
    if (!remote) return null;
    if (remote.user_id !== this.ownerId || !Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new Error("云端验证码记录无效，本机数据已保留。");
    return { ...remote, payload: validateOtpEnvelope(remote.payload) };
  }
  async load(): Promise<{ exists: boolean; offline: boolean }> {
    this.assertCurrent();
    const generation = this.generation;
    this.cache = this.readCache();
    this.candidate = null;
    try {
      const remote = await this.readRemote();
      this.assertCurrent(generation);
      // A locked client cannot authenticate new ciphertext. Keep the last good
      // snapshot until the candidate has been decrypted successfully.
      if (!this.cache.pending) {
        if (!remote && this.cache.base) throw new Error("云端数据不可用。");
        this.candidate = remote;
      }
      this.loaded = true;
      return { exists: this.exists, offline: false };
    } catch (error) {
      this.assertCurrent(generation);
      if (!this.exists) throw error;
      this.loaded = true;
      return { exists: true, offline: true };
    }
  }
  async unlock(password: string): Promise<void> {
    this.assertCurrent();
    const generation = this.generation;
    this.cache = this.readCache();
    const payload = this.cache.pending ?? this.candidate?.payload ?? this.cache.base?.payload;
    if (!payload) throw new Error("请先设置身份验证器解锁密码。");
    const key = await deriveKey(password, payload);
    const document = await decrypt(payload, key, this.ownerId);
    this.assertCurrent(generation);
    if (!this.cache.pending && this.candidate) this.persist({ version: 1, base: this.candidate, pending: null });
    this.key = key;
    this.document = document;
  }
  async create(password: string): Promise<void> {
    this.assertCurrent();
    if (!this.loaded || this.exists) throw new Error("请先读取或解锁已有的身份验证器。");
    if (password.length < 12) throw new Error("解锁密码至少需要 12 个字符，建议使用较长的词组。");
    const generation = this.generation;
    const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(password, { salt, iterations: ITERATIONS });
    const document = emptyDocument();
    const payload = await encrypt(document, key, salt, this.ownerId);
    await exclusive(this.ownerId, async () => {
      this.assertCurrent(generation);
      if (this.readCache().pending || this.readCache().base) throw new Error("其他窗口已创建身份验证器，请重新打开后解锁。");
      this.persist({ version: 1, base: null, pending: payload });
      this.key = key;
      this.document = document;
    });
  }
  lock(): void { this.generation += 1; this.key = null; this.document = null; }

  private async change(update: (document: OtpDocument) => OtpDocument): Promise<void> {
    this.assertCurrent();
    const key = this.key, before = this.document;
    if (!key || !before) throw new Error("请先解锁身份验证器。");
    const generation = this.generation;
    const local = validateDocument(update(structuredClone(before)));
    await exclusive(this.ownerId, async () => {
      this.assertCurrent(generation);
      const latest = this.readCache();
      const payload = latest.pending ?? latest.base?.payload;
      if (!payload || payload.salt !== (this.cache.pending ?? this.cache.base?.payload)?.salt) throw new Error("身份验证器已在其他窗口更改，请重新打开。");
      const current = await decrypt(payload, key, this.ownerId);
      const next = merge(before, local, current).document;
      const encrypted = await encrypt(next, key, payload.salt, this.ownerId);
      this.assertCurrent(generation);
      this.persist({ ...latest, pending: encrypted });
      this.document = next;
    });
  }
  async save(parameters: OtpParameters, id: string = crypto.randomUUID()): Promise<void> {
    const account: OtpAccount = { id, updatedAt: new Date().toISOString(), ...validateOtpParameters(parameters) };
    await this.change(document => ({ ...document, items: [...document.items.filter(item => item.id !== id), account] }));
  }
  async remove(id: string): Promise<void> {
    await this.change(document => ({ ...document, items: [...document.items.filter(item => item.id !== id), { id, updatedAt: new Date().toISOString(), deleted: true }] }));
  }
  async sync(): Promise<{ conflicts: number }> {
    this.assertCurrent();
    const key = this.key;
    if (!key || !this.document) throw new Error("请先解锁身份验证器。");
    const generation = this.generation;
    return exclusive(this.ownerId, async () => {
      let conflicts = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        this.assertCurrent(generation);
        const cache = this.readCache();
        const remote = await this.readRemote();
        this.assertCurrent(generation);
        const payload = cache.pending ?? cache.base?.payload;
        if (!payload) throw new Error("本机验证码数据不可用。");
        if (remote && remote.payload.salt !== payload.salt) throw new Error("云端解锁密码与本机不同。本机数据已保留，请先导出加密备份，再重新打开。");
        const remoteDocument = remote ? await decrypt(remote.payload, key, this.ownerId) : emptyDocument();
        if (!cache.pending) {
          if (!remote) throw new Error("云端验证码数据不可用，本机数据已保留。");
          this.assertCurrent(generation);
          this.persist({ version: 1, base: remote, pending: null });
          this.document = remoteDocument;
          return { conflicts };
        }
        const own = await decrypt(cache.pending, key, this.ownerId);
        const base = cache.base ? await decrypt(cache.base.payload, key, this.ownerId) : emptyDocument();
        const merged = merge(base, own, remoteDocument);
        conflicts += merged.conflicts;
        if (remote && same(merged.document, remoteDocument)) {
          this.assertCurrent(generation);
          this.persist({ version: 1, base: remote, pending: null });
          this.document = remoteDocument;
          return { conflicts };
        }
        const next = await encrypt(merged.document, key, payload.salt, this.ownerId);
        this.assertCurrent(generation);
        this.persist({ version: 1, base: remote, pending: next });
        this.document = merged.document;
        // The RPC compares the authenticated owner and revision atomically.
        const saved = await this.transport.write(this.ownerId, remote?.revision ?? 0, next);
        this.assertCurrent(generation);
        if (!saved) continue;
        this.persist({ version: 1, base: saved, pending: null });
        return { conflicts };
      }
      throw new Error("其他设备仍在修改，当前修改已加密保存在本机，请稍后重试同步。");
    });
  }
  exportBackup(): string {
    const cache = this.readCache();
    const payload = cache.pending ?? cache.base?.payload ?? this.candidate?.payload;
    if (!payload) throw new Error("暂无可备份的验证码数据。");
    return JSON.stringify({ format: FORMAT, version: 1, ownerId: this.ownerId, payload }, null, 2);
  }
  async importBackup(serialized: string, password: string): Promise<number> {
    this.assertCurrent();
    if (!this.loaded || serialized.length > 1_100_000) throw new Error("备份文件无效或过大。");
    let backup: { format: string; version: number; ownerId: string; payload: OtpEnvelope };
    try { backup = JSON.parse(serialized); } catch { throw new Error("备份文件不是有效的 JSON。"); }
    if (backup?.format !== FORMAT || backup.version !== 1 || backup.ownerId !== this.ownerId) throw new Error("请选择当前账号的身份验证器加密备份。");
    const payload = validateOtpEnvelope(backup.payload);
    const generation = this.generation;
    const backupKey = await deriveKey(password, payload);
    const incoming = await decrypt(payload, backupKey, this.ownerId);
    this.assertCurrent(generation);
    if (!this.exists) {
      await exclusive(this.ownerId, async () => {
        this.assertCurrent(generation);
        const cache = this.readCache();
        if (cache.pending || cache.base) throw new Error("身份验证器已在其他窗口创建，请重新打开。");
        this.persist({ version: 1, base: null, pending: payload });
        this.key = backupKey;
        this.document = incoming;
      });
      return incoming.items.filter(isAccount).length;
    }
    if (!this.unlocked) throw new Error("请先解锁当前身份验证器，再导入备份。");
    let imported = 0;
    await this.change(document => {
      const identity = (item: OtpAccount) => JSON.stringify([item.issuer, item.account, item.secret, item.algorithm, item.digits, item.period]);
      const known = new Set(document.items.filter(isAccount).map(identity));
      for (const item of incoming.items.filter(isAccount)) {
        if (known.has(identity(item))) continue;
        known.add(identity(item));
        document.items.push({ ...item, id: crypto.randomUUID(), updatedAt: new Date().toISOString() });
        imported += 1;
      }
      return document;
    });
    return imported;
  }
  /** Explicit recovery action; the UI confirms loss of unsynced local edits. */
  async useCloudCopy(): Promise<void> {
    this.assertCurrent();
    const generation = this.generation;
    await exclusive(this.ownerId, async () => {
      const remote = await this.readRemote();
      this.assertCurrent(generation);
      if (!remote) throw new Error("云端没有可恢复的验证码数据。");
      this.persist({ version: 1, base: remote, pending: null });
      this.candidate = remote;
      this.lock();
    });
  }
}

function cloudError(error: { code?: string } | null): Error {
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "")) return new Error("身份验证器云端存储尚未开通，请先部署数据库更新。");
  return new Error("验证码同步失败，请检查网络或重新登录。本机已保存的加密数据会保留。");
}
async function cloudRequest<T>(ownerId: string, run: (signal: AbortSignal) => PromiseLike<{ data: T; error: { code?: string } | null }>): Promise<T> {
  if (!supabase || getCurrentUserId() !== ownerId || ownerId === "local") throw new Error("请登录后使用跨设备身份验证器。");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await run(controller.signal);
    if (result.error) throw cloudError(result.error);
    return result.data;
  } finally { window.clearTimeout(timer); }
}
export const otpCloudTransport: OtpTransport = {
  read: ownerId => cloudRequest(ownerId, signal => supabase!.from("otp_vaults").select("user_id, revision, payload, updated_at").eq("user_id", ownerId).abortSignal(signal).maybeSingle()),
  write: async (ownerId, revision, payload) => {
    const data = await cloudRequest<OtpVaultRecord[] | null>(ownerId, signal => supabase!.rpc("save_otp_vault", { p_owner_id: ownerId, p_expected_revision: revision, p_payload: payload }).abortSignal(signal));
    return data?.[0] ?? null;
  }
};
