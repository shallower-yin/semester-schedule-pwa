import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeOtpSecret, generateTotp, normalizeOtpSecret, parseOtpUri, type OtpAlgorithm } from "./totp";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

function encodeTestSecret(value: string): string {
  const bits = [...new TextEncoder().encode(value)].map(byte => byte.toString(2).padStart(8, "0")).join("");
  return bits.match(/.{1,5}/g)!.map(group => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(group.padEnd(5, "0"), 2)]).join("");
}

describe("RFC 6238 验证码", () => {
  const vectors = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"]
  ] as const;
  for (const [index, algorithm] of (["SHA1", "SHA256", "SHA512"] as const).entries()) {
    it.each(vectors)(`${algorithm} 在 %s 秒匹配标准向量`, async (seconds, ...expected) => {
      const length = { SHA1: 20, SHA256: 32, SHA512: 64 }[algorithm];
      const secret = encodeTestSecret("1234567890".repeat(7).slice(0, length));
      expect(await generateTotp({ secret, algorithm, digits: 8, period: 30 }, seconds * 1000)).toBe(expected[index]);
    });
  }
  it("保留前导零，按周期刷新且不受设备时区影响", async () => {
    const parameters = { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", algorithm: "SHA1" as const, digits: 6 as const, period: 30 };
    expect(await generateTotp(parameters, 1111111109000)).toBe("081804");
    expect(await generateTotp(parameters, 30000)).toBe(await generateTotp(parameters, 59999));
    expect(await generateTotp(parameters, 60000)).not.toBe(await generateTotp(parameters, 59999));
  });
  it("规范化分组密钥并拒绝损坏数据", () => {
    expect(normalizeOtpSecret("jbsw y3dp-ehpk3pxp")).toBe("JBSWY3DPEHPK3PXP");
    expect(new TextDecoder().decode(decodeOtpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"))).toBe("12345678901234567890");
    for (const secret of ["short", "JBSWY3DPEHPK3PX0", "JBSWY3DPEHPK3PXPX"]) expect(() => normalizeOtpSecret(secret)).toThrow();
  });
  it("解析单个账号二维码的名称及高级参数", () => {
    expect(parseOtpUri("otpauth://totp/GitHub%3Atest%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60")).toEqual({
      issuer: "GitHub", account: "test@example.com", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA256", digits: 8, period: 60
    });
  });
  it("拒绝 HOTP、批量迁移、不支持的参数和歧义链接", () => {
    for (const uri of [
      "otpauth://hotp/test?secret=JBSWY3DPEHPK3PXP",
      "otpauth-migration://offline?data=test",
      "https://example.com/?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/Issuer%3Atest?issuer=Other&secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP&secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP&digits=7"
    ]) expect(() => parseOtpUri(uri)).toThrow();
  });
  it("拒绝非法时间及算法", async () => {
    await expect(generateTotp({ secret: "JBSWY3DPEHPK3PXP", algorithm: "MD5" as OtpAlgorithm, digits: 6, period: 30 })).rejects.toThrow();
    await expect(generateTotp({ secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 }, -1)).rejects.toThrow();
  });
});
