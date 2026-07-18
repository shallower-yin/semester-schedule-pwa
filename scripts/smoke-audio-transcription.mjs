import crypto from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const publishableKey = required("PUBLISHABLE_KEY");
const serviceRoleKey = required("SERVICE_ROLE_KEY");
const bucket = required("R2_BUCKET");
const sourceKeys = [required("SOURCE_KEY_1"), required("SOURCE_KEY_2")];
const runId = process.env.GITHUB_RUN_ID || Date.now().toString();
const smokeEmail = "codex-audio-smoke@example.com";
const password = `${crypto.randomUUID()}Aa1!`;
const r2 = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }
});

let userId = "";
const copiedKeys = [];
let succeeded = false;
try {
  const user = await createSmokeUser();
  userId = user.id;
  await grantAccess(userId);
  const token = await signIn();
  const audios = [];
  for (let index = 0; index < sourceKeys.length; index += 1) {
    const sourceKey = sourceKeys[index];
    const metadata = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
    const objectKey = `ai-audio/${userId}/${crypto.randomUUID()}.mp3`;
    await r2.send(new CopyObjectCommand({ Bucket: bucket, Key: objectKey, CopySource: `${bucket}/${sourceKey}`, ContentType: "audio/mpeg", MetadataDirective: "REPLACE" }));
    copiedKeys.push(objectKey);
    audios.push({
      name: index === 0 ? "张宏伟1.mp3" : "张宏伟3.mp3",
      mimeType: "audio/mpeg",
      size: Number(metadata.ContentLength ?? 0),
      objectKey
    });
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ mode: "audio_transcription", audios, audioLanguage: "zh", summarizeAudio: false })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    if (payload?.diagnosticId) {
      const diagnostic = await fetchDiagnostic(payload.diagnosticId);
      console.error("Audio diagnostic:", JSON.stringify(diagnostic));
    }
    throw new Error(`audio smoke failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const transcript = typeof payload?.transcript === "string" ? payload.transcript : "";
  if (!transcript.includes("张宏伟1.mp3") || !transcript.includes("张宏伟3.mp3") || transcript.length < 100) {
    throw new Error(`audio smoke returned incomplete combined transcript (${transcript.length} chars)`);
  }
  succeeded = true;
  console.log(`PASS combined audio transcription: ${transcript.length} characters, model ${payload.model}`);
} finally {
  await Promise.all(copiedKeys.map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
  if (succeeded) await Promise.all(sourceKeys.map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
  if (userId) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: serviceHeaders() });
  }
}

async function createSmokeUser() {
  const listed = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders() });
  const listPayload = await readJson(listed);
  const existing = listPayload?.users?.find((user) => user.email?.toLowerCase() === smokeEmail);
  if (existing?.id) await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, { method: "DELETE", headers: serviceHeaders() });
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ email: smokeEmail, password, email_confirm: true, user_metadata: { display_name: "音频联合测试", runId } })
  });
  const payload = await readJson(response);
  if (!response.ok || !payload?.id) throw new Error(`create smoke user failed: HTTP ${response.status}`);
  return payload;
}

async function grantAccess(targetUserId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/ai_assistant_access?on_conflict=user_id`, {
    method: "POST",
    headers: serviceHeaders({ "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: targetUserId, enabled: true, role: "member", note: "combined audio smoke", updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`grant smoke access failed: HTTP ${response.status}`);
}

async function signIn() {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password })
  });
  const payload = await readJson(response);
  if (!response.ok || !payload?.access_token) throw new Error(`smoke sign-in failed: HTTP ${response.status}`);
  return payload.access_token;
}

async function fetchDiagnostic(diagnosticId) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_assistant_usage?diagnostic_id=eq.${encodeURIComponent(diagnosticId)}&select=status,error_message,diagnostic_details,latency_ms,created_at&limit=1`,
    { headers: serviceHeaders() }
  );
  const payload = await readJson(response);
  return response.ok ? payload?.[0] ?? null : { lookupStatus: response.status, payload };
}

function serviceHeaders(extra = {}) {
  return { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, ...extra };
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
