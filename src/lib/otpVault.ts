import { getCurrentUserId } from "./identity";
import { supabase } from "./supabase";
import { normalizeOtpSecret, parseOtpUri, validateOtpParameters, type OtpParameters } from "./totp";

const ITERATIONS = 600_000;
const FORMAT = "semester-schedule-otp-backup";
const MAX_ITEMS = 1000;
export interface StoredSecretParameters { kind: "secret"; issuer: string; account: string; secret: string }
export type OtpEntryParameters = (OtpParameters & { kind?: "totp" }) | StoredSecretParameters;
export type OtpAccount = OtpEntryParameters & { id: string; updatedAt: string; deleted?: never };
interface OtpTombstone { id: string; updatedAt: string; deleted: true }
type OtpItem = OtpAccount | OtpTombstone;
export interface OtpDocument { version: 2; items: OtpItem[] }
export interface OtpEnvelope {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}
export type OtpPayload = OtpDocument | OtpEnvelope;
export interface OtpVaultRecord { user_id: string; revision: number; payload: OtpPayload; updated_at: string }
interface OtpCache {
  version: 1;
  base: OtpVaultRecord | null;
  pending: OtpPayload | null;
  // Retain a migration key only until the old encrypted remote snapshot is synced.
  legacy?: { salt: string; key: string };
  discardedLegacy?: OtpEnvelope;
}
export interface OtpTransport {
  read(ownerId: string): Promise<OtpVaultRecord | null>;
  write(ownerId: string, expectedRevision: number, payload: OtpPayload): Promise<OtpVaultRecord | null>;
}

const text = new TextEncoder();
const emptyDocument = (): OtpDocument => ({ version: 2, items: [] });
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

function validateEntry(value: OtpEntryParameters): OtpEntryParameters {
  if (!value || typeof value.issuer !== "string" || typeof value.account !== "string" || typeof value.secret !== "string") throw new Error("密钥记录无效。");
  if (value.kind === "secret") {
    const issuer = value.issuer.trim(), account = value.account.trim();
    if ((!issuer && !account) || issuer.length > 80 || account.length > 160) throw new Error("请填写服务或账号名称（服务最多 80 字，账号最多 160 字）。");
    if (!value.secret.trim() || value.secret.length > 16_384) throw new Error("请填写密钥或令牌，最多 16384 个字符。");
    return { kind: "secret", issuer, account, secret: value.secret };
  }
  if (value.kind !== undefined && value.kind !== "totp") throw new Error("密钥类型无效。");
  return { ...validateOtpParameters(value), kind: "totp" };
}

/** Valid TOTP seeds/URIs generate codes; all other values are stored verbatim. */
export function detectOtpEntry(input: OtpParameters): OtpEntryParameters {
  if (/^otpauth(?:-migration)?:/i.test(input.secret.trim())) {
    const uri = parseOtpUri(input.secret);
    return { ...uri, issuer: input.issuer.trim() || uri.issuer, account: input.account.trim() || uri.account, kind: "totp" };
  }
  try { normalizeOtpSecret(input.secret); }
  catch { return validateEntry({ kind: "secret", issuer: input.issuer, account: input.account, secret: input.secret }); }
  return { ...validateOtpParameters(input), kind: "totp" };
}

function validateDocument(value: unknown): OtpDocument {
  const document = value as OtpDocument;
  // Version 1 is accepted here only for the plaintext inside a legacy envelope.
  if (!document || ![1, 2].includes(document.version) || !Array.isArray(document.items) || document.items.length > MAX_ITEMS) throw new Error("密钥数据格式无效。");
  const ids = new Set<string>();
  const result: OtpDocument = { version: 2, items: document.items.map(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)
      || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("密钥记录无效。");
    ids.add(item.id);
    const fields = { id: item.id, updatedAt: item.updatedAt };
    return item.deleted === true ? { ...fields, deleted: true } : { ...fields, ...validateEntry(item as OtpAccount) };
  }) };
  if (text.encode(JSON.stringify(result)).length > 1_000_000) throw new Error("密钥数据不能超过 1 MB。");
  return result;
}
function validatePayload(value: OtpPayload): OtpPayload {
  return value?.version === 1 ? validateOtpEnvelope(value) : validateDocument(value);
}

async function deriveLegacyKey(password: string, envelope: OtpEnvelope): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持安全解密，请使用 HTTPS 网页或 Android 安装包。");
  if (!password || password.length > 1024) throw new Error("请输入原解锁密码。");
  const material = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: envelope.iterations, salt: decode(envelope.salt) }, material,
    { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}
async function decrypt(envelope: OtpEnvelope, key: CryptoKey, ownerId: string): Promise<OtpDocument> {
  try {
    validateOtpEnvelope(envelope);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv), additionalData: text.encode(`semester-schedule-otp:v1:${ownerId}`) }, key, decode(envelope.ciphertext));
    return validateDocument(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { throw new Error("原解锁密码不正确，或加密数据已损坏。"); }
}

/** Merge against the last synced snapshot without silently discarding a key. */
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
      if (right && isAccount(right)) items.push(right);
      else if (left && isAccount(left)) { items.push(left); continue; }
      else if (right ?? left) { items.push((right ?? left)!); continue; }
      if (left && isAccount(left)) items.push({ ...left, id: crypto.randomUUID(), account: `${left.account.slice(0, 150)}（同步副本）` });
    }
  }
  return { document: validateDocument({ version: 2, items }), conflicts };
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
  get unlocked(): boolean { return this.document !== null; }
  get exists(): boolean { return Boolean(this.cache.pending ?? this.candidate?.payload ?? this.cache.base?.payload); }
  get pending(): boolean { return Boolean(this.cache.pending); }
  get accounts(): OtpAccount[] { return this.document?.items.filter(isAccount).map(item => ({ ...item })) ?? []; }

  private assertCurrent(generation = this.generation): void {
    if (generation !== this.generation || this.ownerId === "local" || getCurrentUserId() !== this.ownerId) throw new Error("账号已变化，请重新打开身份验证器。");
  }
  private validateRecord(value: OtpVaultRecord): OtpVaultRecord {
    if (value.user_id !== this.ownerId || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error("云端密钥记录无效，本机数据已保留。");
    return { ...value, payload: validatePayload(value.payload) };
  }
  private readCache(): OtpCache {
    const raw = this.storage.getItem(cacheKey(this.ownerId));
    if (!raw) return { version: 1, base: null, pending: null };
    try {
      const value = JSON.parse(raw) as OtpCache;
      if (value.version !== 1) throw new Error();
      if (value.base) value.base = this.validateRecord(value.base);
      if (value.pending) value.pending = validatePayload(value.pending);
      if (value.legacy && (decode(value.legacy.key).length !== 32 || decode(value.legacy.salt).length !== 16)) throw new Error();
      if (value.discardedLegacy) value.discardedLegacy = validateOtpEnvelope(value.discardedLegacy);
      return value;
    } catch { throw new Error("本机密钥缓存损坏，请保留备份后重试。"); }
  }
  private persist(cache: OtpCache): void {
    try { this.storage.setItem(cacheKey(this.ownerId), JSON.stringify(cache)); }
    catch { throw new Error("无法保存密钥，请检查设备存储空间。本次修改尚未保存。"); }
    this.cache = cache;
    this.candidate = null;
  }
  private async readRemote(): Promise<OtpVaultRecord | null> {
    const remote = await this.transport.read(this.ownerId);
    return remote ? this.validateRecord(remote) : null;
  }
  private async readDocument(payload: OtpPayload, cache: OtpCache): Promise<OtpDocument> {
    if (payload.version === 2) return validateDocument(payload);
    if (same(payload, cache.discardedLegacy)) return emptyDocument();
    if (!cache.legacy || cache.legacy.salt !== payload.salt) throw new Error("云端仍有旧版加密数据，请先导出本机备份，再重新读取并迁移原有密钥。");
    const key = await crypto.subtle.importKey("raw", decode(cache.legacy.key), "AES-GCM", false, ["decrypt"]);
    return decrypt(payload, key, this.ownerId);
  }
  async load(): Promise<{ exists: boolean; offline: boolean }> {
    this.assertCurrent();
    const generation = this.generation;
    this.document = null;
    this.cache = this.readCache();
    this.candidate = null;
    let offline = false;
    try {
      const remote = await this.readRemote();
      this.assertCurrent(generation);
      if (!this.cache.pending) {
        if (!remote && this.cache.base) throw new Error("云端数据不可用。");
        this.candidate = remote;
      }
    } catch (error) {
      this.assertCurrent(generation);
      if (!this.exists) throw error;
      offline = true;
    }
    const payload = this.cache.pending ?? this.candidate?.payload ?? this.cache.base?.payload;
    if (!payload || payload.version === 2) {
      const document = payload ? validateDocument(payload) : emptyDocument();
      if (!this.cache.pending && this.candidate) this.persist({ version: 1, base: this.candidate, pending: null });
      this.document = document;
    }
    this.loaded = true;
    return { exists: this.exists, offline };
  }
  async migrate(password: string): Promise<void> {
    this.assertCurrent();
    const generation = this.generation;
    const selected = this.cache.pending ?? this.candidate?.payload ?? this.cache.base?.payload;
    if (!this.loaded || selected?.version !== 1) throw new Error("没有需要迁移的旧版加密数据。");
    const key = await deriveLegacyKey(password, selected);
    const document = await decrypt(selected, key, this.ownerId);
    const legacy = { salt: selected.salt, key: encode(new Uint8Array(await crypto.subtle.exportKey("raw", key))) };
    await exclusive(this.ownerId, async () => {
      this.assertCurrent(generation);
      const latest = this.readCache();
      if (!same(latest, this.cache)) throw new Error("本机密钥已在其他窗口更改，请重新打开。");
      this.persist({ ...latest, base: !latest.pending && this.candidate ? this.candidate : latest.base, pending: document, legacy });
      this.document = document;
    });
  }
  /** The UI exports a backup first; preserve all local/cloud snapshots as well. */
  async startOver(): Promise<void> {
    this.assertCurrent();
    if (!this.loaded || this.unlocked || !this.exists) throw new Error("没有需要重新开始的旧版加密数据。");
    const generation = this.generation;
    await exclusive(this.ownerId, async () => {
      this.assertCurrent(generation);
      const latest = this.readCache();
      if (!same(latest, this.cache)) throw new Error("本机密钥已在其他窗口更改，请重新打开。");
      try { this.storage.setItem(`${cacheKey(this.ownerId)}:recovery:${crypto.randomUUID()}`, JSON.stringify({ cache: latest, candidate: this.candidate })); }
      catch { throw new Error("无法保留旧加密备份，旧数据未更改。"); }
      const base = this.candidate ?? latest.base;
      const document = emptyDocument();
      this.persist({ version: 1, base, pending: document, discardedLegacy: base?.payload.version === 1 ? base.payload : undefined });
      this.document = document;
    });
  }
  lock(): void { this.generation += 1; this.document = null; }

  private async change(update: (document: OtpDocument) => OtpDocument): Promise<void> {
    this.assertCurrent();
    const before = this.document;
    if (!before) throw new Error("请先迁移原有密钥。");
    const generation = this.generation;
    const local = validateDocument(update(structuredClone(before)));
    await exclusive(this.ownerId, async () => {
      this.assertCurrent(generation);
      const latest = this.readCache();
      const payload = latest.pending ?? latest.base?.payload;
      if (!payload && this.exists) throw new Error("本机密钥已在其他窗口更改，请重新打开。");
      const current = payload ? await this.readDocument(payload, latest) : emptyDocument();
      const next = merge(before, local, current).document;
      this.assertCurrent(generation);
      this.persist({ ...latest, pending: next });
      this.document = next;
    });
  }
  async save(parameters: OtpEntryParameters, id: string = crypto.randomUUID()): Promise<void> {
    const account: OtpAccount = { id, updatedAt: new Date().toISOString(), ...validateEntry(parameters) };
    await this.change(document => ({ ...document, items: [...document.items.filter(item => item.id !== id), account] }));
  }
  async remove(id: string): Promise<void> {
    await this.change(document => ({ ...document, items: [...document.items.filter(item => item.id !== id), { id, updatedAt: new Date().toISOString(), deleted: true }] }));
  }
  async sync(): Promise<{ conflicts: number }> {
    this.assertCurrent();
    if (!this.document) throw new Error("请先迁移原有密钥。");
    const generation = this.generation;
    return exclusive(this.ownerId, async () => {
      let conflicts = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        this.assertCurrent(generation);
        const cache = this.readCache();
        const remote = await this.readRemote();
        this.assertCurrent(generation);
        const remoteDocument = remote ? await this.readDocument(remote.payload, cache) : emptyDocument();
        if (!cache.pending) {
          if (!remote) {
            if (cache.base) throw new Error("云端密钥数据不可用，本机数据已保留。");
            return { conflicts };
          }
          this.assertCurrent(generation);
          this.persist({ version: 1, base: remote, pending: null });
          this.document = remoteDocument;
          return { conflicts };
        }
        const own = await this.readDocument(cache.pending, cache);
        const base = cache.base ? await this.readDocument(cache.base.payload, cache) : emptyDocument();
        const merged = merge(base, own, remoteDocument);
        conflicts += merged.conflicts;
        if (remote?.payload.version === 2 && same(merged.document, remoteDocument)) {
          this.assertCurrent(generation);
          this.persist({ version: 1, base: remote, pending: null });
          this.document = remoteDocument;
          return { conflicts };
        }
        this.assertCurrent(generation);
        this.persist({ ...cache, base: remote, pending: merged.document });
        this.document = merged.document;
        // The RPC checks the authenticated owner and revision atomically.
        const saved = await this.transport.write(this.ownerId, remote?.revision ?? 0, merged.document);
        this.assertCurrent(generation);
        if (!saved) continue;
        this.persist({ version: 1, base: this.validateRecord(saved), pending: null });
        return { conflicts };
      }
      throw new Error("其他设备仍在修改，当前修改已保存在本机，请稍后重试同步。");
    });
  }
  exportBackup(): string {
    this.assertCurrent();
    const cache = this.readCache();
    const payload = cache.pending ?? cache.base?.payload ?? this.candidate?.payload;
    if (!payload) throw new Error("暂无可备份的密钥数据。");
    return JSON.stringify({ format: FORMAT, version: payload.version, ownerId: this.ownerId, payload }, null, 2);
  }
  async importBackup(serialized: string, password = ""): Promise<number> {
    this.assertCurrent();
    if (!this.loaded || serialized.length > 1_100_000) throw new Error("备份文件无效或过大。");
    let backup: { format: string; version: number; ownerId: string; payload: OtpPayload };
    try { backup = JSON.parse(serialized); } catch { throw new Error("备份文件不是有效的 JSON。"); }
    if (backup?.format !== FORMAT || ![1, 2].includes(backup.version) || backup.ownerId !== this.ownerId || backup.version !== backup.payload?.version) throw new Error("请选择当前账号的身份验证器备份。");
    if (!this.unlocked) throw new Error("请先迁移原有密钥，或保留旧备份并重新开始。");
    const payload = validatePayload(backup.payload);
    const generation = this.generation;
    const incoming = payload.version === 2 ? payload : await decrypt(payload, await deriveLegacyKey(password, payload), this.ownerId);
    this.assertCurrent(generation);
    let imported = 0;
    await this.change(document => {
      const identity = (item: OtpAccount) => JSON.stringify(item.kind === "secret"
        ? ["secret", item.issuer, item.account, item.secret] : ["totp", item.issuer, item.account, item.secret, item.algorithm, item.digits, item.period]);
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
      if (!remote) throw new Error("云端没有可恢复的密钥数据。");
      this.persist({ version: 1, base: remote, pending: null });
      this.document = remote.payload.version === 2 ? remote.payload : null;
    });
  }
}

function cloudError(error: { code?: string } | null): Error {
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "")) return new Error("身份验证器云端存储尚未开通，请先部署数据库更新。");
  return new Error("密钥同步失败，请检查网络或重新登录。本机已保存的数据会保留。");
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
