import { assertEquals, assert } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

Deno.test("bounded 50-way real SQL quota admission and replay", async () => {
  const db = await PGlite.create();
  const user = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key);
      create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
      create table ai_assistant_usage(id uuid default gen_random_uuid(), user_id uuid references auth.users(id), requested_at timestamptz default now(),
        status text, quota_counted boolean not null default false, access_method text, feature_key text, model text,
        prompt_tokens integer, completion_tokens integer, total_tokens integer, estimated_cost_cny numeric,
        latency_ms integer, question_chars integer, diagnostic_id uuid, diagnostic_details jsonb);
      create unique index ai_usage_diag on ai_assistant_usage(diagnostic_id) where diagnostic_id is not null;`);
    await db.query("insert into auth.users values($1)", [user]);
    await db.exec(await Deno.readTextFile(new URL("../../migrations/20260731_zz_ai_quota_counted_attempts.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../../migrations/20261023_audio_submission_quota.sql", import.meta.url)));
    const manifest = JSON.stringify({ audios: [{ objectKey: `ai-audio/${user}/file.wav` }], language: "zh", summarize: true });
    const begin = async (session: string) => {
      const diagnostic = crypto.randomUUID();
      const result = await db.query<{ value: { state: string; result?: unknown } }>(
        "select begin_ai_audio_submission_task($1,$2,$3,'file:one',$4,$5,'member','test',1,1) as value",
        [user, session, manifest, "a".repeat(64), diagnostic]);
      return { ...result.rows[0].value, diagnostic };
    };
    const start = performance.now();
    const distinct = await Promise.all(Array.from({ length: 50 }, () => begin(crypto.randomUUID())));
    assertEquals(distinct.filter(r => r.state === "new").length, 1);
    assertEquals(distinct.filter(r => r.state === "denied").length, 49);
    await db.exec("truncate ai_audio_submission_tasks, ai_audio_submissions, ai_assistant_usage");
    const session = crypto.randomUUID();
    const same = await Promise.all(Array.from({ length: 50 }, () => begin(session)));
    assertEquals(same.filter(r => r.state === "new").length, 1);
    assertEquals(same.filter(r => r.state === "busy").length, 49);
    const winner = same.find(r => r.state === "new")!;
    await db.query("select finish_ai_audio_submission_task($1,$2,'file:one',$3,$4)", [user, session, winner.diagnostic, JSON.stringify({ transcript: "cached" })]);
    let completed = 100;
    for (let batch = 0; batch < 8; batch++) {
      assert(performance.now() - start < 30_000, "30 second stop condition");
      const replay = await Promise.all(Array.from({ length: 50 }, () => begin(session)));
      assertEquals(replay.filter(r => r.state === "success").length, 50);
      for (const r of replay) assertEquals(r.result, { transcript: "cached" });
      completed += replay.length;
    }
    assertEquals((await db.query<{ count: number }>("select count(*)::integer as count from ai_assistant_usage where quota_counted")).rows[0].count, 1);
    console.log(JSON.stringify({ engine: "PGlite single connection queue; not PostgreSQL lock contention", completed, concurrency: 50, elapsedMs: Math.round(performance.now() - start), counted: 1 }));
  } finally { await db.close(); }
});
