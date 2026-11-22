import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { GetObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");

const env = (name) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; };
const base = env("SUPABASE_URL").replace(/\/$/, "");
const serviceHeaders = { apikey: env("SERVICE_ROLE_KEY"), authorization: `Bearer ${env("SERVICE_ROLE_KEY")}`, "content-type": "application/json" };
const s3 = new S3Client({ region: "auto", endpoint: env("R2_ENDPOINT"), credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") } });
const sourceKey = env("SOURCE_KEY_1");
const source = await s3.send(new GetObjectCommand({ Bucket: env("R2_BUCKET"), Key: sourceKey }));
const bytes = await source.Body.transformToByteArray();
assert.equal(createHash("sha256").update(bytes).digest("hex"), env("FIXTURES_SHA256"), "Private source bundle checksum mismatch");
const fixtures = JSON.parse(Buffer.from(bytes).toString("utf8"));
assert(Array.isArray(fixtures.cases) && fixtures.cases.length >= 3 && fixtures.cases.length <= 6, "Need original images and at least two other image cases");
for (const entry of fixtures.cases) {
  assert(entry.images?.length && entry.images.length <= 3);
  for (const image of entry.images) {
    assert.equal(createHash("sha256").update(Buffer.from(image.base64, "base64")).digest("hex"), image.sha256, "Original image checksum mismatch");
  }
}

let userId;
let browser;
const results = [];
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...serviceHeaders, ...init.headers } });
  if (!response.ok) throw new Error(`${path.split("?")[0]} HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function clearRows() {
  for (const table of ["event_occurrence_states", "events", "memos", "memo_folders"]) {
    await request(`/rest/v1/${table}?user_id=eq.${userId}`, { method: "DELETE" });
  }
}

try {
  const runtime = await request("/rest/v1/rpc/get_ai_runtime_settings", { method: "POST", body: "{}" });
  const configuredModel = runtime.text_relay?.supports_text ? runtime.text_relay.text_model : runtime.model;
  const actualModel = String(configuredModel).replace(/^mimo-v2\.5-pro$/, "mimo-v2.6-pro").replace(/^mimo-v2\.5$/, "mimo-v2.6-flash");
  assert(actualModel.includes("mimo-v2.6"), "The configured runtime must use MiMo V2.6 for this validation");
  const email = `codex-ai-attachments-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const user = await request("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { source: "ai-attachment-smoke" } }) });
  userId = user.id;
  assert(userId);
  await request("/rest/v1/ai_assistant_access?on_conflict=user_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: userId, enabled: true, role: "admin", note: "temporary attachment smoke" }) });
  const session = await request("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: env("PUBLISHABLE_KEY"), authorization: "" }, body: JSON.stringify({ email, password }) });
  assert(session.access_token);
  browser = await chromium.launch();
  for (const fixture of fixtures.cases) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addInitScript(({ session, key }) => localStorage.setItem(key, JSON.stringify(session)), {
      session, key: `sb-${new URL(base).hostname.split(".")[0]}-auth-token`
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    let imageUploads = 0;
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/ai-assistant") && req.method() === "POST") {
        try { if (req.postDataJSON()?.action === "create_image_upload") imageUploads++; } catch { /* no payload logging */ }
      }
    });
    await page.goto(env("APP_URL"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "AI 助手", exact: true });
    await dialog.getByRole("button", { name: "导入图片或文档" }).waitFor();
    await dialog.locator('input[type="file"]').first().setInputFiles(fixture.images.map((image) => ({ name: image.name, mimeType: image.mimeType, buffer: Buffer.from(image.base64, "base64") })));
    await page.waitForFunction((count) => document.querySelectorAll('.assistant-input .assistant-attachment-open').length === count, fixture.images.length);
    await dialog.getByRole("button", { name: "发送", exact: true }).waitFor();
    if (fixture.prelude) {
      await dialog.locator("textarea.assistant-composer-textarea").fill(fixture.prelude);
      const preludeResponse = page.waitForResponse((response) => {
        if (!response.url().includes("/functions/v1/ai-assistant") || response.request().method() !== "POST") return false;
        try { return response.request().postDataJSON()?.question === fixture.prelude; } catch { return false; }
      }, { timeout: 240_000 });
      await dialog.getByRole("button", { name: "发送", exact: true }).click();
      const response = await preludeResponse;
      const answer = await response.json();
      assert(response.ok(), `${fixture.id}: initial conversation failed`);
      assert.equal(answer.actions?.length ?? 0, 0, "A request to review without saving must not create records");
      await page.waitForFunction(() => !document.querySelector('.assistant-input textarea')?.disabled);
      console.log(`PASS ${JSON.stringify({ case: fixture.id, stage: "understand-without-saving" })}`);
    }
    await dialog.locator("textarea.assistant-composer-textarea").fill(fixture.question);
    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().includes("/functions/v1/ai-assistant") || response.request().method() !== "POST") return false;
      try { return response.request().postDataJSON()?.question === fixture.question; } catch { return false; }
    }, { timeout: 240_000 });
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    const response = await responsePromise;
    const payload = await response.json();
    assert(response.ok(), `${fixture.id}: ${payload.error || `HTTP ${response.status()}`}`);
    const eventActions = payload.actions?.filter((action) => action.type === "create_event") ?? [];
    assert.equal(eventActions.length, fixture.events.length, `${fixture.id}: real model event count; response ${String(payload.answer).slice(0, 500)}`);
    await dialog.getByText(/已创建备忘录：/).waitFor({ timeout: 60_000 });
    const local = await page.evaluate(async (ownerId) => {
      const databases = await indexedDB.databases();
      for (const info of databases) {
        if (!info.name) continue;
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open(info.name); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        if (!db.objectStoreNames.contains("events") || !db.objectStoreNames.contains("memos")) { db.close(); continue; }
        const tables = {};
        for (const name of ["events", "memos", "memoFolders"]) {
          tables[name] = await new Promise((resolve, reject) => { const req = db.transaction(name).objectStore(name).getAll(); req.onsuccess = () => resolve(req.result.filter((row) => row.user_id === ownerId && !row.deleted_at)); req.onerror = () => reject(req.error); });
        }
        db.close();
        return tables;
      }
      throw new Error("Application database unavailable");
    }, userId);
    assert(local);
    const events = local.events.sort((a, b) => `${a.start_date} ${a.start_time || ""}`.localeCompare(`${b.start_date} ${b.start_time || ""}`));
    assert.equal(events.length, fixture.events.length, `${fixture.id}: actual local event count`);
    for (const [index, expected] of fixture.events.entries()) {
      const actual = events[index];
      assert.equal(actual.start_date, expected.startDate, `${fixture.id} row ${index + 1} start`);
      assert.equal(actual.end_date, expected.endDate, `${fixture.id} row ${index + 1} end`);
      assert.equal(actual.all_day, expected.allDay);
      assert.equal(actual.reminder_enabled, false);
      if (!expected.allDay) { assert.equal(actual.start_time, expected.startTime); assert.equal(actual.end_time, expected.endTime); }
      if (expected.location) assert(actual.location.includes(expected.location));
      for (const token of expected.noteTokens ?? []) assert(actual.note.includes(token), `${fixture.id} row ${index + 1} missing note evidence`);
    }
    assert.equal(local.memoFolders.length, 1);
    assert.equal(local.memoFolders[0].name, fixture.folderName);
    assert.equal(local.memos.length, 1);
    assert.equal(local.memos[0].folder_id, local.memoFolders[0].id);
    assert.equal(local.memos[0].title, fixture.memoTitle);
    assert.equal((local.memos[0].content.match(/^\s*(?:○|◯|[-*]\s+\[ \])/gm) ?? []).length, fixture.events.length, "Must create real checkable tasks");
    if (fixture.requireImageUpload) assert(imageUploads > 0, "Large image must use binary upload, not the old Base64 limit");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "账号同步", exact: true }).click();
    const sync = page.getByRole("button", { name: "立即同步", exact: true });
    await sync.waitFor();
    if (await sync.isEnabled()) await sync.click();
    let cloudEvents = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      cloudEvents = await request(`/rest/v1/events?select=id&user_id=eq.${userId}`);
      if (cloudEvents.length === events.length) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.deepEqual(cloudEvents.map((row) => row.id).sort(), events.map((row) => row.id).sort(), "Created events must sync to the real cloud database");
    const cloudMemos = await request(`/rest/v1/memos?select=id,folder_id,content&user_id=eq.${userId}`);
    assert.equal(cloudMemos.length, 1);
    assert.equal(cloudMemos[0].folder_id, local.memoFolders[0].id);
    assert.equal(cloudMemos[0].content, local.memos[0].content);
    if (fixture.retryQuestion) {
      await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
      const assistant = page.getByRole("dialog", { name: "AI 助手", exact: true });
      await assistant.locator("textarea.assistant-composer-textarea").fill(fixture.retryQuestion);
      const retryResponse = page.waitForResponse((response) => {
        if (!response.url().includes("/functions/v1/ai-assistant") || response.request().method() !== "POST") return false;
        try { return response.request().postDataJSON()?.question === fixture.retryQuestion; } catch { return false; }
      }, { timeout: 240_000 });
      await assistant.getByRole("button", { name: "发送", exact: true }).click();
      const response = await retryResponse;
      assert(response.ok(), "A natural-language continuation must succeed");
      await page.waitForFunction(() => !document.querySelector('.assistant-input textarea')?.disabled);
      const counts = await page.evaluate(async (ownerId) => {
        for (const { name } of await indexedDB.databases()) {
          const db = await new Promise((resolve) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); });
          if (!db.objectStoreNames.contains("events")) { db.close(); continue; }
          const counts = {};
          for (const name of ["events", "memos", "memoFolders"]) counts[name] = await new Promise((resolve) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result.filter((row) => row.user_id === ownerId && !row.deleted_at).length); });
          db.close(); return counts;
        }
      }, userId);
      assert.deepEqual(counts, { events: fixture.events.length, memos: 1, memoFolders: 1 }, "Continuation must not create duplicate records");
      console.log(`PASS ${JSON.stringify({ case: fixture.id, stage: "natural-continuation-no-duplicates", ...counts })}`);
    }
    const result = { case: fixture.id, model: actualModel, originalImages: fixture.images.length, events: events.length, folders: 1, memos: 1, checkableTasks: fixture.events.length, cloudVerified: true, imageUploads };
    results.push(result);
    console.log(`PASS ${JSON.stringify(result)}`);
    await context.close();
    await clearRows();
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### 线上原图验证通过\n\n提交：${env("EXPECTED_COMMIT")}\n\n${results.map((result) => `- ${result.case}: ${result.originalImages} 张图片，${result.events} 个事项，${result.checkableTasks} 条可勾选待办，文件夹归属和云端同步已核对。`).join("\n")}\n`);
} finally {
  const cleanupErrors = [];
  for (const cleanup of [
    () => browser?.close(),
    () => userId ? clearRows() : undefined,
    () => userId ? request(`/auth/v1/admin/users/${userId}`, { method: "DELETE" }) : undefined,
    () => s3.send(new DeleteObjectCommand({ Bucket: env("R2_BUCKET"), Key: sourceKey }))
  ]) { try { await cleanup(); } catch { cleanupErrors.push("temporary test cleanup failed"); } }
  if (cleanupErrors.length) throw new Error(cleanupErrors.join("; "));
}
