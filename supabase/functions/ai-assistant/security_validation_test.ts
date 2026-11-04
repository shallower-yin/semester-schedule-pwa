import { assert, assertEquals } from "jsr:@std/assert@1";
import { S3Client } from "npm:@aws-sdk/client-s3@3.1089.0";

// Bounded, offline adversarial validation. Known defects deliberately stay red.
Deno.test("bounded offline AI security characterization", async (t) => {
  const user = "11111111-1111-4111-8111-111111111111";
  const other = "33333333-3333-4333-8333-333333333333";
  const env = { SUPABASE_URL: "https://security-db.invalid", SUPABASE_PUBLISHABLE_KEYS: '{"default":"test"}',
    SERVICE_ROLE_KEY: "test-service", MIMO_PAYG_API_KEY: "test-model", MIMO_PAYG_BASE_URL: "https://security-model.invalid/v1" };
  const old = Object.fromEntries(Object.keys(env).map(k => [k, Deno.env.get(k)]));
  const oldFetch = globalThis.fetch, oldServe = Deno.serve, oldSend = S3Client.prototype.send;
  let provider = 0, reserves = 0, storage = 0, providerBodyChars = 0, providerUserChars = 0;
  let denied = false;
  let relays: Record<string, unknown> = {};
  try {
    for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
    Deno.serve = (() => ({} as Deno.HttpServer)) as typeof Deno.serve;
    const { handleAiRequest } = await import("./index.ts");
    Deno.serve = oldServe;
    S3Client.prototype.send = (async () => { storage++; throw new Error("Unexpected storage access"); }) as typeof S3Client.prototype.send;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      assert(["security-db.invalid", "security-model.invalid"].includes(url.hostname), "Network escape");
      if (url.hostname === "security-model.invalid") {
        provider++; const raw = await request.text(); providerBodyChars = raw.length;
        const sent = JSON.parse(raw); providerUserChars = sent.messages.filter((m: { role: string }) => m.role === "user").map((m: { content: unknown }) => typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length).reduce((a: number, b: number) => a + b, 0);
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok","actions":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg", ...relays });
      if (url.pathname === "/auth/v1/user") return request.headers.get("authorization") === "Bearer invalid" ? Response.json({ error: "invalid" }, { status: 401 }) : Response.json({ id: user });
      if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json(denied ? [] : [{ enabled: true, role: "member", expires_at: null }]);
      if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
      if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") { reserves++; return Response.json({ allowed: true, todayRequests: 1, weekRequests: 1 }); }
      if (url.pathname === "/rest/v1/ai_assistant_usage") return new Response(null, { status: 204 });
      if (url.pathname === "/rest/v1/rpc/close_ai_audio_submission") return Response.json(null);
      throw new Error(`Unexpected mock endpoint ${url.pathname}`);
    };
    const invoke = async (body: unknown, token = "Bearer test", raw = false) => {
      const response = await handleAiRequest(new Request("https://edge.invalid/ai-assistant", { method: "POST", headers: { authorization: token, "content-type": "application/json" }, body: raw ? String(body) : JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    };
    await t.step("missing authentication and permission deny before provider", async () => {
      assertEquals((await invoke({ question: "hi" }, "")).status, 401);
      const invalid = await invoke({ question: "hi" }, "Bearer invalid");
      assertEquals(invalid.status, 401);
      denied = true;
      assertEquals((await invoke({ question: "hi" })).status, 403);
      denied = false;
      assertEquals(provider, 0); assertEquals(reserves, 0);
    });
    await t.step("malformed bodies should return a client error", async () => {
      const results = [];
      for (const body of ["{", "null", '{"question":42}', '{"question":{}}']) results.push((await invoke(body, "Bearer test", true)).status);
      assertEquals(provider, 0); assertEquals(reserves, 0);
      assertEquals(results, [400, 400, 400, 400]);
    });
    await t.step("invalid attachment and audio metadata reject before quota provider and storage", async () => {
      const before = { reserves, provider, storage };
      const bad = [{ question: "hi", attachments: [{ kind: "image", dataUrl: "javascript:bad" }] },
        { mode: "audio_transcription", audio: { dataUrl: "invalid" } },
        { mode: "audio_transcription", audios: [{ name: "test.wav", mimeType: "audio/wav", size: -1, objectKey: `ai-audio/${user}/22222222-2222-4222-8222-222222222222.wav` }] },
        { action: "extract_document_batch", attachments: [] },
        { action: "summarize_document_batch", document: { text: "", pageCount: 1, startPage: 1, endPage: 1 } }];
      denied = true;
      assertEquals((await invoke(bad[0])).status, 403);
      denied = false;
      for (const body of bad) assertEquals((await invoke(body)).status, 400);
      assertEquals({ reserves, provider, storage }, before);
    });
    await t.step("unused broken relay leaves config cleanup and other provider paths available", async () => {
      relays = { audio_relay: { supports_audio: true, api_key: "test", audio_model: "test", base_url: "https://unresolvable.invalid" } };
      assertEquals((await invoke({ action: "configuration" })).status, 200);
      assertEquals((await invoke({ question: "hi" })).status, 200);
      relays = { text_relay: { supports_text: true, api_key: "test", text_model: "test", base_url: "https://[::ffff:127.0.0.1]" } };
      assertEquals((await invoke({ action: "configuration" })).status, 200);
      assertEquals((await invoke({ action: "close_audio_submission", audioSubmissionId: "22222222-2222-4222-8222-222222222222" })).status, 200);
      const before = provider;
      assertEquals((await invoke({ question: "hi" })).status >= 400, true);
      assertEquals(provider, before);
      relays = {};
    });
    await t.step("cross-account object keys and expired/tampered signatures never reach storage or provider", async () => {
      const before = { reserves, provider, storage };
      const key = `ai-documents/${other}/22222222-2222-4222-8222-222222222222/page-0001.jpg`;
      assertEquals((await invoke({ action: "delete_document_uploads", document: { objectKeys: [key] } })).status, 500);
      const part = { fileName: "test.wav", mimeType: "audio/wav", size: 1000, objectKey: `ai-audio/${user}/22222222-2222-4222-8222-222222222222.wav`, language: "zh", partIndex: 0, partCount: 1 };
      for (const token of ["tampered", `${Date.now() - 1}.nonce.${"a".repeat(64)}`, `${Date.now() + 86_400_000}.nonce.${"a".repeat(64)}`]) assertEquals((await invoke({ action: "transcribe_audio_part", audioPart: part, audioPartSignature: token })).status, 403);
      assertEquals({ reserves, provider, storage }, before);
    });
    await t.step("hardening target: reject 2 MiB assistant question before provider", async () => {
      const before = provider, started = performance.now();
      const result = await invoke({ question: "x".repeat(2 * 1024 * 1024) });
      console.log("OBSERVATION oversized input", { status: result.status, providerCalls: provider - before, providerBodyChars, providerUserChars, elapsedMs: Math.round(performance.now() - started) });
      assert([400, 413].includes(result.status), "Oversized question must return 400/413");
      assertEquals(provider - before, 0);
    });
    await t.step("500 requests with 50 workers retain request-local diagnostics", async () => {
      const started = performance.now(), seen = new Set<string>();
      let cursor = 0, completed = 0, active = 0, peak = 0;
      const quiet = console.error; console.error = () => {};
      try {
        await Promise.all(Array.from({ length: 50 }, async () => {
          while (cursor < 500) {
            assert(performance.now() - started < 30_000, "30 second stop condition");
            const n = cursor++; active++; peak = Math.max(peak, active);
            const result = await invoke({ question: n % 2 ? 42 : {} });
            active--; completed++;
            assertEquals(result.status, 400);
            assert(typeof result.body.diagnosticId === "string");
            assert(!seen.has(result.body.diagnosticId)); seen.add(result.body.diagnosticId);
          }
        }));
      } finally { console.error = quiet; }
      assertEquals(completed, 500); assertEquals(peak, 50);
      console.log(JSON.stringify({ completed, peak, elapsedMs: Math.round(performance.now() - started), uniqueDiagnostics: seen.size }));
    });
  } finally {
    globalThis.fetch = oldFetch; Deno.serve = oldServe; S3Client.prototype.send = oldSend;
    for (const [k, v] of Object.entries(old)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
});
