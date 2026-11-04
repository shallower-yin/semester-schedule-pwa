import { assertEquals, assert } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.1089.0";

type Handler = (request: Request) => Response | Promise<Response>;
const user = "11111111-1111-4111-8111-111111111111";

Deno.test("real Edge handler and PostgreSQL charge one complete audio submission", async () => {
  const db = await PGlite.create();
  const previousFetch = globalThis.fetch;
  const previousServe = Deno.serve;
  const previousS3Send = S3Client.prototype.send;
  const environment = { SUPABASE_URL: "https://audio-db.invalid", SUPABASE_PUBLISHABLE_KEYS: '{"default":"test"}',
    SERVICE_ROLE_KEY: "test-service", MIMO_PAYG_API_KEY: "test-audio-key", MIMO_PAYG_BASE_URL: "https://audio-model.invalid/v1",
    R2_ENDPOINT: "https://audio-storage.invalid", R2_BUCKET: "test-audio", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test-secret" };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map((key) => [key, Deno.env.get(key)]));
  let handler: Handler | undefined;
  try {
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key);
      create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
      create table ai_assistant_usage(id uuid default gen_random_uuid(), user_id uuid references auth.users(id), requested_at timestamptz default now(),
        status text, quota_counted boolean not null default false, access_method text, feature_key text, model text,
        prompt_tokens integer, completion_tokens integer, total_tokens integer, estimated_cost_cny numeric,
        latency_ms integer, question_chars integer, diagnostic_id uuid, diagnostic_details jsonb);
      create unique index ai_usage_diag on ai_assistant_usage(diagnostic_id) where diagnostic_id is not null;
    `);
    await db.query("insert into auth.users values($1)", [user]);
    await db.exec(await Deno.readTextFile(new URL("../../migrations/20260731_zz_ai_quota_counted_attempts.sql", import.meta.url)));
    const legacyTasks = await Deno.readTextFile(new URL("../../migrations/20260731_security_and_consistency_hardening.sql", import.meta.url));
    await db.exec(legacyTasks.slice(legacyTasks.indexOf("create table if not exists public.ai_paid_task_executions"), legacyTasks.indexOf("update public.events")));
    await db.exec(await Deno.readTextFile(new URL("../../migrations/20261023_audio_submission_quota.sql", import.meta.url)));
    for (const [key, value] of Object.entries(environment)) Deno.env.set(key, value);
    Deno.serve = ((callback: Handler) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
    await import("./index.ts");
    Deno.serve = previousServe;
    assert(handler);
    S3Client.prototype.send = (async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return { ContentLength: 1000 };
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(1000)) } };
      throw new Error("Unexpected storage command");
    }) as typeof S3Client.prototype.send;
    let modelCalls = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg",
        audio_provider: "mimo", audio_model: "mimo-v2.5-asr", feature_quotas: { audio_transcription: { member_daily_limit: 1, member_weekly_limit: 1 } } });
      if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
      if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json([{ enabled: true, role: "member", expires_at: null }]);
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").at(-1)!;
        const args = await request.json();
        // Real SQL functions, not a JS quota counter. Provider and HTTP only are mocked.
        const keys = Object.keys(args);
        const sql = `select ${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")}) as value`;
        const result = await db.query<{ value: unknown }>(sql, keys.map((key) => typeof args[key] === "object" && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
        return Response.json(result.rows[0].value);
      }
      if (url.pathname === "/rest/v1/ai_assistant_usage") {
        const body = await request.json();
        if (body.diagnostic_id) await db.query("update ai_assistant_usage set status=$2,total_tokens=$3,estimated_cost_cny=$4 where diagnostic_id=$1",
          [body.diagnostic_id, body.status, body.total_tokens, body.estimated_cost_cny]);
        return new Response(null, { status: 204 });
      }
      if (url.hostname === "audio-model.invalid") {
        modelCalls++;
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: "测试摘要" } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
      }
      throw new Error(`Unexpected mocked endpoint ${url.pathname}`);
    };
    const invoke = async (body: unknown) => {
      const response = await handler!(new Request("https://edge.invalid/ai-assistant", {
        method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify(body)
      }));
      return { status: response.status, body: await response.json() };
    };
    const file = { name: "recording.wav", mimeType: "audio/wav", size: 1000, objectKey: `ai-audio/${user}/22222222-2222-4222-8222-222222222222.wav` };
    const secondFile = { ...file, name: "second.wav", objectKey: `ai-audio/${user}/44444444-4444-4444-8444-444444444444.wav` };
    const submission = { id: crypto.randomUUID(), audios: [file, secondFile], language: "zh", summarize: true };
    const planned = await invoke({ action: "plan_audio_parts", audios: submission.audios, audioLanguage: "zh" });
    assertEquals(planned.status, 200, JSON.stringify(planned.body));
    for (const task of planned.body.tasks) {
      const part = { action: "transcribe_audio_part", audioPart: task, audioPartSignature: task.signature, audioSubmission: submission };
      const firstPart = await invoke(part);
      assertEquals(firstPart.status, 200, JSON.stringify(firstPart.body));
      assertEquals(await invoke(part), firstPart);
    }
    assertEquals(modelCalls, 2);
    const summary = { action: "summarize_audio_transcript", audioTranscript: "正文", audioSubmission: submission };
    const first = await invoke(summary);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    assertEquals(first.body.summary, "测试摘要");
    const retry = await invoke(summary);
    assertEquals(retry, first);
    assertEquals(modelCalls, 3);
    const finalized = await invoke({ action: "finalize_audio_transcription", audios: submission.audios,
      audioSegmentResults: submission.audios.map((audio) => ({ objectKey: audio.objectKey, segments: ["正文"] })), summarizeAudio: false, audioSubmission: submission });
    assertEquals(finalized.status, 200, JSON.stringify(finalized.body));
    assertEquals(finalized.body.quota.daily.used, 1);
    assertEquals((await db.query<{ count: number }>("select count(*)::integer as count from ai_assistant_usage where quota_counted")).rows[0].count, 1);
    assertEquals((await db.query<{ sum: number }>("select sum(total_tokens)::integer as sum from ai_assistant_usage")).rows[0].sum, 90);
    // An unrelated submission still requires its own available quota.
    const denied = await invoke({ mode: "audio_transcription", audios: [file], audioLanguage: "zh", summarizeAudio: false,
      audioSubmission: { ...submission, id: crypto.randomUUID() } });
    assertEquals(denied.status, 429);
    assertEquals(modelCalls, 3);
    assertEquals((await invoke({ action: "close_audio_submission", audioSubmissionId: submission.id })).status, 200);
  } finally {
    globalThis.fetch = previousFetch;
    Deno.serve = previousServe;
    S3Client.prototype.send = previousS3Send;
    for (const [key, value] of Object.entries(previousEnvironment)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    await db.close();
  }
});
