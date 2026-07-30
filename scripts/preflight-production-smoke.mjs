import { createHash, createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";

const smokeKind = process.env.SMOKE_KIND?.trim() || "";
const supportedKinds = new Set(["audio", "long-pdf", "ai-access", "memo-images"]);
if (!supportedKinds.has(smokeKind)) {
  throw new Error(`Unsupported SMOKE_KIND: ${smokeKind || "(empty)"}`);
}

const requiredNames = ["SUPABASE_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"];
if (smokeKind === "audio" || smokeKind === "long-pdf") {
  requiredNames.push("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY");
}
if (smokeKind === "audio") requiredNames.push("SOURCE_KEY_1", "SOURCE_KEY_2");

const missingNames = requiredNames.filter((name) => !process.env[name]?.trim());
if (missingNames.length > 0) {
  await skip(`缺少运行配置：${missingNames.join(", ")}`);
} else {
  try {
    await verifySupabaseAdminAccess();
    if (smokeKind !== "memo-images") await verifyPublicAiConfiguration();

    if (smokeKind === "audio") await verifyFreshAudioSources();
    if (smokeKind === "long-pdf") {
      verifyPageCount();
      await verifyR2Access();
    }

    await ready();
  } catch (error) {
    await skip(safeReason(error));
  }
}

async function verifySupabaseAdminAccess() {
  const response = await fetch(
    `${env("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new PreflightError(`Supabase 管理鉴权不可用（HTTP ${response.status}）`);
}

async function verifyPublicAiConfiguration() {
  const publishableKey = env("PUBLISHABLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ action: "configuration" })
  });
  if (!response.ok) throw new PreflightError(`AI 配置端点不可用（HTTP ${response.status}）`);
}

async function verifyFreshAudioSources() {
  const firstKey = env("SOURCE_KEY_1");
  const secondKey = env("SOURCE_KEY_2");
  const firstMatch = firstKey.match(/^codex-smoke-source\/([a-zA-Z0-9_-]{8,80})\/audio-1\.mp3$/);
  const secondMatch = secondKey.match(/^codex-smoke-source\/([a-zA-Z0-9_-]{8,80})\/audio-2\.m4a$/);
  if (!firstMatch || !secondMatch || firstMatch[1] !== secondMatch[1]) {
    throw new PreflightError("两份音频不是同一批一次性上传素材");
  }

  const metadata = [];
  for (const key of [firstKey, secondKey]) {
    const response = await headR2Object(key);
    if (response.status === 404) throw new PreflightError("一次性音频素材不存在或已被清理，请重新上传");
    if (!response.ok) throw new PreflightError(`R2 素材预检不可用（HTTP ${response.status}）`);
    metadata.push({
      contentLength: Number(response.headers.get("content-length") || 0),
      lastModified: new Date(response.headers.get("last-modified") || "")
    });
  }

  const maximumAgeMinutes = positiveInteger(process.env.SMOKE_SOURCE_MAX_AGE_MINUTES, 120);
  const oldestAllowed = Date.now() - maximumAgeMinutes * 60_000;
  for (const item of metadata) {
    if (item.contentLength <= 0) throw new PreflightError("一次性音频素材为空");
    if (!Number.isFinite(item.lastModified.getTime()) || item.lastModified.getTime() < oldestAllowed) {
      throw new PreflightError(`一次性音频素材已超过 ${maximumAgeMinutes} 分钟，请重新上传`);
    }
  }
}

async function verifyR2Access() {
  const response = await headR2Object(`codex-smoke-preflight/nonexistent-${Date.now()}`);
  if (response.ok || response.status === 404) return;
  throw new PreflightError(`R2 鉴权不可用（HTTP ${response.status}）`);
}

async function headR2Object(objectKey) {
  const endpoint = new URL(env("R2_ENDPOINT"));
  const pathParts = [
    ...endpoint.pathname.split("/").filter(Boolean),
    env("R2_BUCKET"),
    ...objectKey.split("/")
  ];
  const canonicalUri = `/${pathParts.map(awsUriEncode).join("/")}`;
  endpoint.pathname = canonicalUri;
  endpoint.search = "";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256("");
  const canonicalHeaders = [
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ""
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "HEAD",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const dateKey = hmac(Buffer.from(`AWS4${env("R2_SECRET_ACCESS_KEY")}`, "utf8"), dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return fetch(endpoint, {
    method: "HEAD",
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${env("R2_ACCESS_KEY_ID")}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  });
}

function verifyPageCount() {
  const pageCount = Number.parseInt(process.env.SMOKE_PAGE_COUNT ?? "", 10);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 120) {
    throw new PreflightError("扫描 PDF 页数必须在 1–120 之间");
  }
}

async function ready() {
  await writeOutput("ready", "true");
  await writeSummary("### 烟测预检通过\n\n已确认配置、鉴权和无付费依赖，真实烟测现在开始。");
  console.log("Smoke preflight passed; the production smoke may start.");
}

async function skip(reason) {
  await writeOutput("ready", "false");
  await writeOutput("reason", reason);
  await writeSummary(`### 烟测未启动\n\n${reason}\n\n这属于运行前置条件不满足，不是产品回归，因此不会标记为失败。`);
  console.log(`::notice title=Smoke test not started::${escapeWorkflowCommand(reason)}`);
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) {
    console.log(JSON.stringify({ [name]: value }));
    return;
  }
  await appendFile(outputPath, `${name}=${String(value).replaceAll("\n", " ")}\n`, "utf8");
}

async function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (summaryPath) await appendFile(summaryPath, `${markdown}\n`, "utf8");
}

function serviceHeaders() {
  const serviceRoleKey = env("SERVICE_ROLE_KEY");
  return { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
}

function env(name) {
  return process.env[name]?.trim() || "";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function awsUriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function safeReason(error) {
  if (error instanceof PreflightError) return error.message;
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  if (status) return `外部依赖预检不可用（HTTP ${status}），真实烟测未启动`;
  return "外部依赖预检不可用，真实烟测未启动";
}

function escapeWorkflowCommand(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

class PreflightError extends Error {}
