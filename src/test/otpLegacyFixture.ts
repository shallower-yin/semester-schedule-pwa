import type { OtpEnvelope, OtpVaultRecord } from "../lib/otpVault";
import type { OtpParameters } from "../lib/totp";

export const legacyOtpPassword = "correct horse battery staple";
export const legacyOtpEntry: OtpParameters = { issuer: "GitHub", account: "otp-test@example.invalid", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 };

/** Generate the exact password-encrypted format written by the previous app. */
export async function legacyOtpRecord(ownerId = "alice", revision = 1, parameters = legacyOtpEntry): Promise<OtpVaultRecord & { payload: OtpEnvelope }> {
  const text = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", text.encode(legacyOtpPassword), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const document = { version: 1, items: [{ ...parameters, id: "first", updatedAt: "2026-11-22T04:00:00.000Z" }] };
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: text.encode(`semester-schedule-otp:v1:${ownerId}`) }, key, text.encode(JSON.stringify(document)));
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return {
    user_id: ownerId, revision, updated_at: "2026-11-22T04:00:00.000Z",
    payload: { version: 1, kdf: "PBKDF2-SHA256", iterations: 600_000, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
  };
}
