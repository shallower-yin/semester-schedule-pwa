import crypto from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { splitAudioForAsr } from "../supabase/functions/_shared/audioChunking.ts";

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const publishableKey = required("PUBLISHABLE_KEY");
const serviceRoleKey = required("SERVICE_ROLE_KEY");
const bucket = required("R2_BUCKET");
const sourceKeys = [required("SOURCE_KEY_1"), required("SOURCE_KEY_2")];
const sourceNames = ["3B复习2.mp3", "cyl工程图录音.m4a"];
const runId = process.env.GITHUB_RUN_ID || Date.now().toString();
const smokeEmail = "codex-audio-smoke@example.com";
const password = `${crypto.randomUUID()}Aa1!`;
const r2 = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }
});

let userId = "";
const temporaryKeys = [];
let succeeded = false;
try {
  const user = await createSmokeUser();
  userId = user.id;
  // Disposable smoke users are admins so the exact 38-leaf-file regression is not hidden by a
  // low member quota; production signed leaf calls themselves do not consume per-part quota.
  await grantAccess(userId);
  const token = await signIn();

  const mp3Metadata = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKeys[0] }));
  const mp3 = {
    name: sourceNames[0],
    mimeType: "audio/mpeg",
    size: Number(mp3Metadata.ContentLength ?? 0),
    objectKey: `ai-audio/${userId}/${crypto.randomUUID()}.mp3`
  };
  await r2.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: mp3.objectKey,
    CopySource: `${bucket}/${sourceKeys[0]}`,
    ContentType: mp3.mimeType,
    MetadataDirective: "REPLACE"
  }));
  temporaryKeys.push(mp3.objectKey);

  const m4aObject = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKeys[1] }));
  if (!m4aObject.Body) throw new Error("M4A smoke source body is empty");
  const m4aBytes = await m4aObject.Body.transformToByteArray();
  const m4aChunks = splitAudioForAsr(m4aBytes, sourceNames[1], "audio/mp4");
  if (m4aChunks.length < 2) throw new Error("real M4A did not enter ordered client chunking");
  const aacAudios = [];
  for (let index = 0; index < m4aChunks.length; index += 1) {
    const chunk = m4aChunks[index];
    const audio = {
      name: `p${String(index).padStart(2, "0")}_cyl工程图录音.aac`,
      mimeType: "audio/aac",
      size: chunk.bytes.length,
      objectKey: `ai-audio/${userId}/${crypto.randomUUID()}.aac`
    };
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: audio.objectKey, Body: chunk.bytes, ContentType: audio.mimeType }));
    temporaryKeys.push(audio.objectKey);
    aacAudios.push(audio);
  }

  const mp3Plan = await callAi(token, {
    action: "plan_audio_transcription",
    audios: [mp3],
    audioLanguage: "zh"
  });
  if (mp3Plan?.strategy !== "progressive" || !Array.isArray(mp3Plan.tasks) || mp3Plan.tasks.length < 2) {
    throw new Error("real MP3 did not receive a progressive plan");
  }
  const mp3Segments = [];
  for (const task of [...mp3Plan.tasks].sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    const part = await callAi(token, {
      action: "transcribe_audio_range",
      audioRangeSignature: task.signature,
      audioRange: task
    }, { "x-audio-range-signature": task.signature });
    if (!part?.transcript?.trim()) throw new Error(`MP3 part ${task.chunkIndex + 1} returned no transcript`);
    mp3Segments.push(part.transcript.trim());
  }

  const aacPlan = await callAi(token, {
    action: "plan_audio_parts",
    audios: aacAudios,
    audioLanguage: "zh"
  });
  if (!Array.isArray(aacPlan?.tasks) || aacPlan.tasks.length !== aacAudios.length) {
    throw new Error(`real M4A signed plan incomplete (${aacPlan?.tasks?.length ?? 0}/${aacAudios.length})`);
  }
  const aacSegments = [];
  for (const task of [...aacPlan.tasks].sort((a, b) => a.partIndex - b.partIndex)) {
    const part = await callAi(token, {
      action: "transcribe_audio_part",
      audioPartSignature: task.signature,
      audioPart: task
    }, { "x-audio-part-signature": task.signature });
    if (!part?.transcript?.trim()) throw new Error(`M4A part ${task.partIndex + 1} returned no transcript`);
    aacSegments.push(part.transcript.trim());
  }

  const audios = [mp3, ...aacAudios];
  const audioSegmentResults = [
    { name: mp3.name, objectKey: mp3.objectKey, segments: mp3Segments },
    ...aacAudios.map((audio, index) => ({ name: audio.name, objectKey: audio.objectKey, segments: [aacSegments[index]] }))
  ];
  const finalized = await callAi(token, {
    action: "finalize_audio_transcription",
    audios,
    audioSegmentResults,
    summarizeAudio: true,
    skipAudioObjectCleanup: true
  });
  const transcript = typeof finalized?.transcript === "string" ? finalized.transcript : "";
  const firstAt = transcript.indexOf(sourceNames[0]);
  const m4aFirstPartAt = transcript.indexOf(aacAudios[0].name);
  const m4aLastPartAt = transcript.indexOf(aacAudios.at(-1).name);
  if (firstAt < 0 || m4aFirstPartAt <= firstAt || m4aLastPartAt <= m4aFirstPartAt || transcript.length < 500) {
    throw new Error(`audio smoke returned incomplete or unordered transcript (${transcript.length} chars)`);
  }
  if (typeof finalized?.summary !== "string" || finalized.summary.trim().length < 20) {
    throw new Error("audio smoke did not return a usable summary");
  }
  succeeded = true;
  console.log(`PASS exact ordered audio smoke: MP3 ${mp3Segments.length} parts, M4A ${aacSegments.length} parts, ${transcript.length} characters, model ${finalized.model}`);
} finally {
  await Promise.all(temporaryKeys.map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
  if (succeeded) await Promise.all(sourceKeys.map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
  if (userId) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: serviceHeaders() });
  }
}

async function callAi(token, body, extraHeaders = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  if (!response.ok) {
    if (payload?.diagnosticId) console.error("Audio diagnostic:", JSON.stringify(await fetchDiagnostic(payload.diagnosticId)));
    throw new Error(`audio smoke failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
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
    body: JSON.stringify({ user_id: targetUserId, enabled: true, role: "admin", note: "exact ordered audio smoke", updated_at: new Date().toISOString() })
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
