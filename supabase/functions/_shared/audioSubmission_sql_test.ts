// Isolated PostgreSQL/WASM regression, no network or production credentials.
// deno test --no-config --node-modules-dir=none --allow-read --allow-env audioSubmission_sql_test.ts
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const user = "11111111-1111-4111-8111-111111111111";
const manifest = { audios: [{ objectKey: `ai-audio/${user}/file.wav` }], language: "zh", summarize: true };
const hash = "a".repeat(64);

Deno.test("audio quota migration executes idempotently and bills full submissions once", async (t) => {
  const db = await PGlite.create();
  try {
    // Only auth identity and unrelated schema scaffolding are stubbed. Both
    // reservation functions below are the actual production migration SQL.
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create table auth.users (id uuid primary key);
      create function auth.role() returns text language sql as $$ select coalesce(current_setting('test.auth_role', true), 'service_role') $$;
      create table public.ai_assistant_usage (
        id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
        requested_at timestamptz not null default now(), status text not null,
        quota_counted boolean not null default false, access_method text, feature_key text, model text,
        prompt_tokens integer default 0, completion_tokens integer default 0, total_tokens integer default 0,
        estimated_cost_cny numeric, latency_ms integer, question_chars integer,
        diagnostic_id uuid, diagnostic_details jsonb
      );
      create unique index ai_usage_diagnostic_unique on public.ai_assistant_usage(diagnostic_id) where diagnostic_id is not null;
    `);
    await db.query("insert into auth.users values ($1)", [user]);
    await db.exec(await Deno.readTextFile(new URL("../../migrations/20260731_zz_ai_quota_counted_attempts.sql", import.meta.url)));
    const migration = await Deno.readTextFile(new URL("../../migrations/20261023_audio_submission_quota.sql", import.meta.url));
    await db.exec(migration);
    await db.exec(migration);
    const reset = () => db.exec("truncate ai_audio_submission_tasks, ai_audio_submissions, ai_assistant_usage");
    const begin = async (session: string, key = "file:one", diagnostic = crypto.randomUUID(), limits = 1, fingerprint = hash, files = manifest) => {
      const result = await db.query<{ value: { state: string; result?: unknown; todayRequests?: number } }>(
        "select begin_ai_audio_submission_task($1,$2,$3,$4,$5,$6,'member','test-model',$7,$7) as value",
        [user, session, JSON.stringify(files), key, fingerprint, diagnostic, limits]);
      return { ...result.rows[0].value, diagnostic };
    };
    const finish = (session: string, key: string, diagnostic: string, result: unknown = { transcript: "done" }) =>
      db.query("select finish_ai_audio_submission_task($1,$2,$3,$4,$5)", [user, session, key, diagnostic, result === null ? null : JSON.stringify(result)]);
    const close = (session: string) => db.query("select close_ai_audio_submission($1,$2)", [user, session]);
    const counted = async () => (await db.query<{ count: number }>("select count(*)::integer as count from ai_assistant_usage where quota_counted")).rows[0].count;

    await t.step("parts, finalize and summary consume one attempt; all provider usage remains in budget", async () => {
      const session = crypto.randomUUID();
      for (const key of ["file:one", "file:two", "range:three:0", "finalize", "summary"]) {
        const start = await begin(session, key);
        assertEquals(start.state, "new");
        assertEquals(start.todayRequests, 1);
        await db.query("update ai_assistant_usage set total_tokens=30, estimated_cost_cny=0.01 where diagnostic_id=$1", [start.diagnostic]);
        await finish(session, key, start.diagnostic);
      }
      assertEquals(await counted(), 1);
      assertEquals((await begin(session, "file:one")).state, "success");
      assertEquals((await begin(crypto.randomUUID())).state, "denied");
      const budget = await db.query<{ value: { usedTokens: number; allowed: boolean } }>("select check_ai_global_budget(500, 140) as value");
      assertEquals(budget.rows[0].value.usedTokens, 150);
      assertEquals(budget.rows[0].value.allowed, false);
    });

    await t.step("concurrent admissions cannot double reserve a submission or overspend a daily limit", async () => {
      await reset();
      const session = crypto.randomUUID();
      const results = await Promise.all([begin(session), begin(session)]);
      assertEquals(results.map((item) => item.state).sort(), ["busy", "new"]);
      assertEquals(await counted(), 1);
      await reset();
      const distinct = await Promise.all([begin(crypto.randomUUID()), begin(crypto.randomUUID())]);
      assertEquals(distinct.map((item) => item.state).sort(), ["denied", "new"]);
      assertEquals(await counted(), 1);
    });

    await t.step("failed task retry is quota-idempotent, token-fenced and bounded", async () => {
      await reset();
      const session = crypto.randomUUID();
      let previous = "00000000-0000-4000-8000-000000000000";
      for (let attempt = 0; attempt < 6; attempt++) {
        const start = await begin(session);
        assertEquals(start.state, "new");
        await finish(session, "file:one", previous, null);
        assertEquals((await begin(session)).state, "busy");
        await finish(session, "file:one", start.diagnostic, null);
        previous = start.diagnostic;
      }
      assertEquals((await begin(session)).state, "limited");
      assertEquals(await counted(), 1);
    });

    await t.step("manifest/payload changes, closed sessions and expired sessions cannot authorize new work", async () => {
      await reset();
      const session = crypto.randomUUID();
      const first = await begin(session);
      await finish(session, "file:one", first.diagnostic);
      assertEquals((await begin(session, "file:one", crypto.randomUUID(), 1, "b".repeat(64))).state, "mismatch");
      assertEquals((await begin(session, "file:two", crypto.randomUUID(), 1, hash, { ...manifest, language: "en" })).state, "mismatch");
      await close(session);
      assertEquals((await begin(session, "file:two")).state, "closed");
      assertEquals((await begin(session)).state, "success"); // Lost responses remain recoverable.
      await db.query("update ai_audio_submissions set expires_at=now()-interval '1 second' where submission_id=$1", [session]);
      assertEquals((await begin(session)).state, "expired");
      const cancelledBeforeStart = crypto.randomUUID();
      await close(cancelledBeforeStart);
      assertEquals((await begin(cancelledBeforeStart)).state, "mismatch");
      assertEquals(await counted(), 1);
    });

    await t.step("summary cannot open a free session, access is service-role only and stages have concurrency limit", async () => {
      await reset();
      const session = crypto.randomUUID();
      assertEquals((await begin(session, "summary")).state, "missing");
      assertEquals(await counted(), 0);
      for (let index = 0; index < 4; index++) assertEquals((await begin(session, `file:${index}`)).state, "new");
      assertEquals((await begin(session, "file:blocked")).state, "limited");
      await db.exec("set test.auth_role = 'authenticated'");
      await assertRejects(() => begin(crypto.randomUUID()), Error, "service role required");
      await db.exec("set test.auth_role = 'service_role'");
      const privileges = await db.query<{ access: boolean }>("select has_table_privilege('authenticated','ai_audio_submissions','select') as access");
      assertEquals(privileges.rows[0].access, false);
    });
  } finally {
    await db.close();
  }
});
