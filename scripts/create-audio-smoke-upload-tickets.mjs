import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const requestId = required("REQUEST_ID");
if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw new Error("Invalid REQUEST_ID");
const publicKey = crypto.createPublicKey(Buffer.from(required("RSA_PUBLIC_KEY_BASE64"), "base64").toString("utf8"));
const bucket = required("R2_BUCKET");
const client = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }
});

const sources = [
  { key: `codex-smoke-source/${requestId}/audio-1.mp3`, contentType: "audio/mpeg" },
  { key: `codex-smoke-source/${requestId}/audio-2.m4a`, contentType: "audio/mp4" }
];
const tickets = await Promise.all(sources.map(async (source) => ({
  ...source,
  uploadUrl: await getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket,
    Key: source.key,
    ContentType: source.contentType
  }), { expiresIn: 3600 })
})));

// The repository is public, so never print presigned R2 URLs. Encrypt a random AES key with the
// caller's one-use RSA public key, then expose only the authenticated ciphertext in the Actions log.
const aesKey = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
const plaintext = Buffer.from(JSON.stringify({ requestId, tickets }), "utf8");
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const envelope = {
  encryptedKey: crypto.publicEncrypt({ key: publicKey, oaepHash: "sha256" }, aesKey).toString("base64"),
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  ciphertext: ciphertext.toString("base64")
};
console.log(`ENCRYPTED_UPLOAD_TICKETS=${Buffer.from(JSON.stringify(envelope)).toString("base64")}`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
