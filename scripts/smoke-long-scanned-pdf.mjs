import crypto from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const publishableKey = required("PUBLISHABLE_KEY");
const serviceRoleKey = required("SERVICE_ROLE_KEY");
const bucket = required("R2_BUCKET");
const pageCount = positiveInteger("SMOKE_PAGE_COUNT", 25);
const smokeEmail = "codex-scanned-pdf-smoke@example.com";
const password = `${crypto.randomUUID()}Aa1!`;
const documentId = crypto.randomUUID();
const r2 = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }
});
const pageImage = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCACAAIADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAYCAQf/xAAjEAEAAgEDBAIDAAAAAAAAAAAAAQIDBBIhBRExYRNBIiNx/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/APQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATOmw3wY83UKYMGP4NTqrb6z+zPPyZKxS3Ecd5j7nxAKYSeCkaHU49B1OuCNNStskRfJuxTe0RFd0zEeZrlnmPMx99nK5tNeem2yYNJOKMerpWmszfhXtlpHFpr64jtHH8BWjGLbOKk027Nsbdvjt69NgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//2Q==",
  "base64"
);

let userId = "";
const objectKeys = [];
try {
  await verifyPublicConfiguration();
  const user = await createSmokeUser();
  userId = user.id;
  await grantAccess(userId);
  const token = await signIn();
  const remotePages = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const objectKey = `ai-documents/${userId}/${documentId}/page-${String(pageNumber).padStart(4, "0")}.jpg`;
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: pageImage, ContentType: "image/jpeg" }));
    objectKeys.push(objectKey);
    remotePages.push({ pageNumber, objectKey, size: pageImage.length });
  }

  const textParts = [];
  const processingUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  for (let start = 0; start < remotePages.length; start += 6) {
    const batch = remotePages.slice(start, start + 6);
    const batchResponse = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
      method: "POST",
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "extract_document_batch",
        document: { feature: "mind_map" },
        attachments: [{
          kind: "document",
          name: "25页扫描文档.pdf",
          mimeType: "application/pdf",
          pageCount,
          documentId,
          remotePages: batch
        }]
      })
    });
    const batchPayload = await readJson(batchResponse);
    if (!batchResponse.ok || typeof batchPayload?.text !== "string") {
      throw new Error(`scanned PDF batch ${start + 1} failed: HTTP ${batchResponse.status} ${JSON.stringify(batchPayload).slice(0, 800)}`);
    }
    textParts.push(`第 ${start + 1}-${Math.min(pageCount, start + batch.length)} 页：\n${batchPayload.text}`);
    processingUsage.prompt_tokens += Number(batchPayload?.usage?.prompt_tokens ?? 0);
    processingUsage.completion_tokens += Number(batchPayload?.usage?.completion_tokens ?? 0);
    processingUsage.total_tokens += Number(batchPayload?.usage?.total_tokens ?? 0);
    for (const page of batch) {
      if (await objectExists(page.objectKey)) throw new Error(`completed batch page was not deleted: ${page.objectKey}`);
    }
  }
  const processed = {
    kind: "document",
    name: "25页扫描文档.pdf",
    mimeType: "application/pdf",
    pageCount,
    processedPageCount: pageCount,
    text: textParts.join("\n\n"),
    processingUsage
  };
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      mode: "mind_map",
      question: "请把附件的读取过程整理成一份简洁的长文档处理思维导图。",
      mindMapDepth: "quick",
      attachments: [processed]
    })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    if (payload?.diagnosticId) {
      const diagnostic = await fetchDiagnostic(payload.diagnosticId);
      console.error("Scanned PDF diagnostic:", JSON.stringify(diagnostic));
    }
    throw new Error(`long scanned PDF smoke failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  if (!payload?.mindMap?.label) throw new Error("long scanned PDF smoke did not return a mind map");

  const followupResponse = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      mode: "mind_map_followup",
      question: "What repeated English word appears on the scanned document pages?",
      mindMap: payload.mindMap,
      attachments: [{ ...processed, processingUsage: undefined }],
      history: []
    })
  });
  const followupPayload = await readJson(followupResponse);
  if (!followupResponse.ok) {
    if (followupPayload?.diagnosticId) {
      const diagnostic = await fetchDiagnostic(followupPayload.diagnosticId);
      console.error("Mind map follow-up diagnostic:", JSON.stringify(diagnostic));
    }
    throw new Error(`mind map follow-up smoke failed: HTTP ${followupResponse.status} ${JSON.stringify(followupPayload).slice(0, 800)}`);
  }
  if (typeof followupPayload?.answer !== "string" || !followupPayload.answer.trim()) {
    throw new Error(`mind map follow-up smoke returned an empty answer: ${JSON.stringify(followupPayload).slice(0, 500)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  for (const objectKey of objectKeys) {
    if (await objectExists(objectKey)) throw new Error(`temporary page was not deleted after success: ${objectKey}`);
  }
  console.log(
    `PASS ${pageCount}-page scanned PDF: ${processed.text.length} extracted characters; follow-up: ${followupPayload.answer.trim().slice(0, 120)}`
  );
} finally {
  await Promise.all(objectKeys.map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
  if (userId) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: serviceHeaders() });
  }
}

async function verifyPublicConfiguration() {
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${publishableKey}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "configuration" })
  });
  const payload = await readJson(response);
  if (!response.ok || !Number.isInteger(payload?.maxDocumentPages) || payload.maxDocumentPages < 1) {
    throw new Error(`public AI configuration failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
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
    body: JSON.stringify({ email: smokeEmail, password, email_confirm: true, user_metadata: { display_name: "扫描文档测试" } })
  });
  const payload = await readJson(response);
  if (!response.ok || !payload?.id) throw new Error(`create smoke user failed: HTTP ${response.status}`);
  return payload;
}

async function grantAccess(targetUserId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/ai_assistant_access?on_conflict=user_id`, {
    method: "POST",
    headers: serviceHeaders({ "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: targetUserId, enabled: true, role: "member", note: "long scanned PDF smoke", updated_at: new Date().toISOString() })
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

async function objectExists(objectKey) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === "NotFound") return false;
    throw error;
  }
}

async function fetchDiagnostic(diagnosticId) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_assistant_usage?diagnostic_id=eq.${encodeURIComponent(diagnosticId)}&select=status,error,diagnostic_details,latency_ms,requested_at&limit=1`,
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

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
