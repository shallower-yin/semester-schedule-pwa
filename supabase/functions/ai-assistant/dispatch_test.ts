import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.1089.0";

type Handler = (request: Request) => Response | Promise<Response>;

Deno.test("AI dispatch preserves authentication, admission, diagnostics and cleanup boundaries", async (t) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const documentId = "22222222-2222-4222-8222-222222222222";
  const objectKey = `ai-documents/${userId}/${documentId}/page-0001.jpg`;
  const environment = {
    SUPABASE_URL: "https://dispatch-db.invalid", SUPABASE_PUBLISHABLE_KEYS: '{"default":"test"}',
    SERVICE_ROLE_KEY: "test-service", MIMO_PAYG_API_KEY: "test-model", MIMO_PAYG_BASE_URL: "https://dispatch-model.invalid/v1",
    R2_ENDPOINT: "https://dispatch-storage.invalid", R2_BUCKET: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test"
  };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map((key) => [key, Deno.env.get(key)]));
  const previousServe = Deno.serve;
  const previousFetch = globalThis.fetch;
  const previousSend = S3Client.prototype.send;
  let handler: Handler | undefined;
  let hasAccess = true;
  let hasQuota = true;
  let providerStatus = 200;
  let cleanupFails = false;
  const calls: string[] = [];
  const reservations: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const reset = () => {
    hasAccess = true; hasQuota = true; providerStatus = 200; cleanupFails = false;
    calls.length = 0; reservations.length = 0; logs.length = 0;
  };
  try {
    for (const [key, value] of Object.entries(environment)) Deno.env.set(key, value);
    Deno.serve = ((callback: Handler) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
    const entrypoint = await import("./index.ts");
    Deno.serve = previousServe;
    assert(handler);
    assertEquals(handler, entrypoint.handleAiRequest, "The deployed callback must be the exported handler");
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      calls.push(url.pathname);
      if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") return Response.json({
        provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg", audio_provider: "mimo", audio_model: "mimo-v2.5-asr",
        feature_quotas: { mind_map: { enabled_for_all: false, member_daily_limit: 2, member_weekly_limit: 5 } }
      });
      if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
      if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json(hasAccess ? [{ enabled: true, role: "member", expires_at: null }] : []);
      if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
      if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") {
        reservations.push(await request.json());
        return Response.json({ allowed: hasQuota, todayRequests: hasQuota ? 1 : 2, weekRequests: 2 });
      }
      if (url.pathname === "/rest/v1/rpc/close_ai_audio_submission") return Response.json(null);
      if (url.pathname === "/rest/v1/ai_assistant_usage") { logs.push(await request.json()); return new Response(null, { status: 204 }); }
      if (url.hostname === "dispatch-model.invalid") return Response.json({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "结果", actions: [] }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      }, { status: providerStatus });
      throw new Error(`Unexpected mocked endpoint: ${url.pathname}`);
    };
    S3Client.prototype.send = (async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        calls.push(`get:${command.input.Key}`);
        return { Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) } };
      }
      if (command instanceof DeleteObjectCommand) {
        calls.push(`delete:${command.input.Key}`);
        if (cleanupFails) throw new Error("mock cleanup failure");
        return {};
      }
      throw new Error("Unexpected storage command");
    }) as typeof S3Client.prototype.send;
    const invoke = async (body: unknown, options: { method?: string; authorized?: boolean } = {}) => {
      const method = options.method ?? "POST";
      const response = await handler!(new Request("https://edge.invalid/ai-assistant", {
        method,
        headers: { ...(options.authorized === false ? {} : { authorization: "Bearer test-user" }), "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {})
      }));
      assertEquals(response.headers.get("access-control-allow-origin"), "*");
      return { status: response.status, body: await response.json() };
    };
    const summary = { action: "summarize_document_batch", document: { name: "test.pdf", feature: "mind_map", pageCount: 3, startPage: 1, endPage: 2, text: "正文" } };
    const extract = { action: "extract_document_batch", document: { feature: "mind_map" }, attachments: [
      { kind: "document", name: "scan.pdf", remotePages: [{ objectKey, pageNumber: 1, size: 3 }] }
    ] };

    await t.step("HTTP guards run before authentication and configuration", async () => {
      reset();
      assertEquals(await invoke({}, { method: "OPTIONS", authorized: false }), { status: 200, body: { ok: true } });
      assertEquals(await invoke({}, { method: "GET" }), { status: 405, body: { error: "Method not allowed" } });
      assertEquals((await invoke({}, { authorized: false })).status, 401);
      assertEquals(calls, []);
    });
    await t.step("configuration is authenticated but does not authorize or charge a feature", async () => {
      reset(); hasAccess = false;
      const result = await invoke({ action: "configuration" });
      assertEquals(result.status, 200);
      assertEquals(result.body.supportsAttachments, true);
      assertEquals(calls, ["/rest/v1/rpc/get_ai_runtime_settings", "/auth/v1/user"]);
    });
    await t.step("unknown action retains legacy fallback to the assistant", async () => {
      reset();
      const result = await invoke({ action: "future-client-action", question: "你好" });
      assertEquals(result.status, 200);
      assertEquals(result.body.answer, "结果");
      assertEquals(reservations[0].p_feature_key, "assistant");
      assertEquals(calls.filter((item) => item === "/v1/chat/completions").length, 1);
    });
    await t.step("document permission and quota refusal never call the provider", async () => {
      reset(); hasAccess = false;
      assertEquals((await invoke(summary)).body.code, "AI_ACCESS_REQUIRED");
      assertEquals(reservations.length, 0);
      assertEquals(calls.includes("/v1/chat/completions"), false);
      reset(); hasQuota = false;
      const denied = await invoke(summary);
      assertEquals(denied.status, 429);
      assertEquals(denied.body.code, "AI_QUOTA_EXCEEDED");
      assertEquals(reservations[0].p_stage, "document_summarize");
      assertEquals(calls.includes("/v1/chat/completions"), false);
    });
    await t.step("document summary keeps feature-scoped usage and page metadata", async () => {
      reset();
      const result = await invoke(summary);
      assertEquals(result.status, 200);
      assertEquals(result.body.processedPageCount, 2);
      assertEquals(logs.length, 1);
      assertEquals(logs[0].feature_key, "mind_map");
      assertEquals(logs[0].total_tokens, 30);
      assertEquals(logs[0].question_chars, 2);
      assertEquals(logs[0].diagnostic_details, { stage: "document_summarize", startPage: 1, endPage: 2 });
    });
    await t.step("extracted pages are cleaned after success and cleanup failure does not erase the result", async () => {
      for (const failCleanup of [false, true]) {
        reset(); cleanupFails = failCleanup;
        const result = await invoke(extract);
        assertEquals(result.status, 200);
        assertEquals(result.body.processedPageCount, 1);
        assertEquals(reservations[0].p_stage, "document_extract");
        assertEquals(calls.at(-1), `delete:${objectKey}`);
        assertEquals(logs[0].status, "success");
      }
    });
    await t.step("provider failure retains pages and returns the same diagnostic boundary", async () => {
      reset(); providerStatus = 400;
      const result = await invoke(extract);
      assertEquals(result.status, 500);
      assertStringIncludes(result.body.error, "扫描 PDF 第 1 页读取失败（HTTP 400）");
      assert(typeof result.body.diagnosticId === "string");
      assertEquals(logs[0].diagnostic_id, result.body.diagnosticId);
      assertEquals(logs[0].status, "error");
      assertEquals(logs[0].feature_key, "mind_map");
      assertEquals(calls.includes(`delete:${objectKey}`), false);
    });
    await t.step("cleanup remains available without feature access or a fresh quota", async () => {
      reset(); hasAccess = false; hasQuota = false;
      assertEquals((await invoke({ action: "delete_document_uploads", document: { objectKeys: [objectKey, objectKey] } })).status, 200);
      assertEquals(calls.filter((item) => item === `delete:${objectKey}`).length, 1);
      assertEquals((await invoke({ action: "close_audio_submission", audioSubmissionId: documentId })).status, 200);
      assertEquals(reservations.length, 0);
      assertEquals(calls.includes("/rest/v1/ai_assistant_access"), false);
    });
    await t.step("invalid signed audio never reserves a legacy task or a submission", async () => {
      const audio = { name: "test.wav", mimeType: "audio/wav", size: 1000, objectKey: `ai-audio/${userId}/${documentId}.wav` };
      const part = { fileName: audio.name, mimeType: audio.mimeType, size: audio.size, objectKey: audio.objectKey, language: "zh", partIndex: 0, partCount: 1 };
      for (const submission of [undefined, { id: documentId, audios: [audio], language: "zh", summarize: true }]) {
        reset();
        const result = await invoke({ action: "transcribe_audio_part", audioPart: part, audioPartSignature: "invalid", audioSubmission: submission });
        assertEquals(result.status, 403);
        assertEquals(reservations.length, 0);
        assertEquals(calls.includes("/rest/v1/rpc/begin_ai_audio_submission_task"), false);
        assertEquals(calls.includes("/rest/v1/rpc/begin_ai_paid_task"), false);
        assertEquals(calls.includes("/v1/chat/completions"), false);
      }
    });
  } finally {
    Deno.serve = previousServe;
    globalThis.fetch = previousFetch;
    S3Client.prototype.send = previousSend;
    for (const [key, value] of Object.entries(previousEnvironment)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
