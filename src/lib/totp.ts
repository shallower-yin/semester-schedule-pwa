export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export interface OtpParameters {
  issuer: string;
  account: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: 6 | 8;
  period: number;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeOtpSecret(value: string): string {
  const secret = value.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (secret.length < 16 || secret.length > 512 || /[^A-Z2-7]/.test(secret)) {
    throw new Error("密钥应为至少 16 位的 Base32 字符（A–Z、2–7），也可粘贴 otpauth 链接。");
  }
  decodeOtpSecret(secret);
  return secret;
}

export function decodeOtpSecret(secret: string): Uint8Array<ArrayBuffer> {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    const value = BASE32.indexOf(character);
    if (value < 0) throw new Error("密钥含有无效字符。");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits >= 5 || buffer !== 0) throw new Error("密钥长度或末尾字符无效，请重新复制完整密钥。");
  return new Uint8Array(bytes);
}

export function validateOtpParameters(input: OtpParameters): OtpParameters {
  const issuer = input.issuer.trim();
  const account = input.account.trim();
  if ((!issuer && !account) || issuer.length > 80 || account.length > 160) throw new Error("请填写服务或账号名称（服务最多 80 字，账号最多 160 字）。");
  if (!["SHA1", "SHA256", "SHA512"].includes(input.algorithm)) throw new Error("不支持此验证码算法。");
  if (input.digits !== 6 && input.digits !== 8) throw new Error("仅支持 6 位或 8 位验证码。");
  if (!Number.isInteger(input.period) || input.period < 1 || input.period > 3600) throw new Error("验证码周期应为 1–3600 秒。");
  return { issuer, account, secret: normalizeOtpSecret(input.secret), algorithm: input.algorithm, digits: input.digits, period: input.period };
}

export function parseOtpUri(value: string): OtpParameters {
  if (value.length > 4096) throw new Error("二维码或链接内容过长。");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请输入有效的 otpauth 链接。"); }
  if (url.protocol === "otpauth-migration:") throw new Error("暂不支持批量迁移二维码，请使用单个账号二维码或手动密钥。");
  if (url.protocol !== "otpauth:" || url.hostname !== "totp" || url.username || url.password || url.port || url.hash) {
    throw new Error("仅支持基于时间的 TOTP 账号二维码。");
  }
  for (const key of ["secret", "issuer", "algorithm", "digits", "period"]) {
    if (url.searchParams.getAll(key).length > 1) throw new Error("链接中含有重复参数。");
  }
  let label: string;
  try { label = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error("账号名称编码无效。"); }
  const separator = label.indexOf(":");
  const prefix = separator < 0 ? "" : label.slice(0, separator).trim();
  const issuer = (url.searchParams.get("issuer") ?? prefix).trim();
  if (prefix && issuer !== prefix) throw new Error("二维码中的服务名称不一致。");
  return validateOtpParameters({
    issuer,
    account: (separator < 0 ? label : label.slice(separator + 1)).trim(),
    secret: url.searchParams.get("secret") ?? "",
    algorithm: (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase() as OtpAlgorithm,
    digits: Number(url.searchParams.get("digits") ?? 6) as 6 | 8,
    period: Number(url.searchParams.get("period") ?? 30)
  });
}

/** RFC 6238. Use epoch time directly; local timezone never enters the calculation. */
export async function generateTotp(parameters: Pick<OtpParameters, "secret" | "algorithm" | "digits" | "period">, now = Date.now()): Promise<string> {
  if (!Number.isFinite(now) || now < 0 || !Number.isInteger(parameters.period) || parameters.period <= 0
    || (parameters.digits !== 6 && parameters.digits !== 8) || !["SHA1", "SHA256", "SHA512"].includes(parameters.algorithm)) throw new Error("验证码参数无效。");
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持安全加密，请使用 HTTPS 网页或 Android 安装包。");
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(now / 1000 / parameters.period)));
  const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[parameters.algorithm];
  const key = await crypto.subtle.importKey("raw", decodeOtpSecret(normalizeOtpSecret(parameters.secret)), { name: "HMAC", hash }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % (10 ** parameters.digits)).padStart(parameters.digits, "0");
}
