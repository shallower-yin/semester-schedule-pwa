// deno test --no-config --no-lock --node-modules-dir=none --allow-read --allow-env qingmingAnniversaries_sql_test.ts
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
// Use the same locked dependency installed by npm ci; do not resolve a second calendar version.
import { Solar } from "../../../node_modules/lunar-typescript/dist/lib/index.mjs";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const migrationUrl = new URL("../../migrations/20261107_qingming_anniversary_dates.sql", import.meta.url);

Deno.test("Qingming migration preserves installed reminder RPC and matches the deterministic calendar", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec("create role anon; create role authenticated;");
    const previousMigration = await Deno.readTextFile(new URL("../../migrations/20260924_lunar_anniversaries.sql", import.meta.url));
    const rpc = previousMigration.slice(previousMigration.indexOf("create function public.claim_due_reminders"));
    // Install the complete repository RPC with additional configuration and ACL
    // representing security improvements that this migration must preserve.
    await db.exec(rpc);
    await db.exec("alter function public.claim_due_reminders(text) set statement_timeout = '3s'; " +
      "grant execute on function public.claim_due_reminders(text) to authenticated; " +
      "comment on function public.claim_due_reminders(text) is 'preserve existing reminder security';");
    const metadata = async () => (await db.query("select prosecdef, proconfig, proacl::text, proowner::integer, " +
      "pg_get_function_result(oid) as result_type, obj_description(oid, 'pg_proc') as comment " +
      "from pg_proc where oid='public.claim_due_reminders(text)'::regprocedure")).rows;
    const beforeMetadata = await metadata();
    const definition = async () => (await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.claim_due_reminders(text)'::regprocedure) as definition"
    )).rows[0].definition;
    const before = await definition();
    const migration = await Deno.readTextFile(migrationUrl);
    await db.exec(migration);
    const after = await definition();

    await t.step("patches only the annual holiday expressions, preserving security and return contracts", async () => {
      const replacement = migration.match(/\$expression\$([\s\S]*?)\$expression\$/)?.[1];
      const lunarReplacement = migration.match(/\$lunar\$([\s\S]*?)\$lunar\$/)?.[1];
      const solarReplacement = migration.match(/\$solar\$([\s\S]*?)\$solar\$/)?.[1];
      const lowerReplacement = migration.match(/\$lower\$([\s\S]*?)\$lower\$/)?.[1];
      assert(replacement && lunarReplacement && solarReplacement && lowerReplacement);
      const source = /public\.anniversary_date_for_year\s*\(\s*anniversary\.date\s*,\s*year\.value\s*\)/g;
      assertEquals([...before.matchAll(source)].length, 1);
      assertEquals(after, before.replace(source, () => replacement)
        .replace(/where\s+anniversary\.calendar_type\s*=\s*'lunar'/, () => lunarReplacement)
        .replace(/where\s+coalesce\s*\(\s*anniversary\.calendar_type\s*,\s*'solar'\s*\)\s*<>\s*'lunar'/, () => solarReplacement)
        .replace(/occurrence\.occurrence_date\s*>=\s*anniversary\.date/, () => lowerReplacement));
      assertEquals(await metadata(), beforeMetadata);
      assertEquals(after.includes("invalid dispatcher token"), true);
      assertEquals(after.includes("on conflict do nothing"), true);
      assertEquals(after.includes("unnest(anniversary.lunar_occurrence_dates)"), true);
    });

    await t.step("all 201 SQL dates equal lunar-typescript 1.8.7 solar-term dates", async () => {
      const rows = (await db.query<{ year: number; date: string }>("select year, " +
        "public.qingming_date_for_year(year)::text as date " +
        "from generate_series(1900,2100) as years(year) order by year")).rows;
      assertEquals(rows.length, 201);
      for (const row of rows) {
        const terms = Solar.fromYmd(row.year, 4, 5).getLunar().getJieQiTable() as Record<string, { toYmd(): string }>;
        assertEquals(row.date, terms["清明"].toYmd(), String(row.year));
      }
      assertEquals((await db.query("select public.qingming_date_for_year(1899) as low, " +
        "public.qingming_date_for_year(2101) as high, public.qingming_date_for_year(null) as empty")).rows,
        [{ low: null, high: null, empty: null }]);
      assertEquals((await db.query("select has_function_privilege('anon','public.qingming_date_for_year(integer)','execute') as anon, " +
        "has_function_privilege('authenticated','public.qingming_date_for_year(integer)','execute') as authenticated")).rows,
        [{ anon: false, authenticated: false }]);
    });

    await t.step("SQL reminder branch includes mislabeled lunar Qingming and leaves other records unchanged", async () => {
      const replacement = migration.match(/\$expression\$([\s\S]*?)\$expression\$/)?.[1];
      const lunarReplacement = migration.match(/\$lunar\$([\s\S]*?)\$lunar\$/)?.[1];
      const solarReplacement = migration.match(/\$solar\$([\s\S]*?)\$solar\$/)?.[1];
      const lowerReplacement = migration.match(/\$lower\$([\s\S]*?)\$lower\$/)?.[1];
      assert(replacement && lunarReplacement && solarReplacement && lowerReplacement);
      await db.exec("create function public.anniversary_date_for_year(source_date date, target_year integer) " +
        "returns date language sql immutable as $$ select make_date(target_year,extract(month from source_date)::integer,extract(day from source_date)::integer) $$;");
      const rows = (await db.query<{ kind: string; title: string; calendar_type: string; year: number; date: string; source: string }>(
        "with anniversaries(kind,title,date,calendar_type,lunar_occurrence_dates) as (values " +
        "('holiday','清明节',date '2026-04-05','solar',array[date '2028-03-14'])," +
        "('holiday','2026年清明',date '2026-04-05','lunar',array[date '2028-03-14'])," +
        "('holiday',' 清 明 节 ',date '2026-04-05','solar',array[date '2028-03-14'])," +
        "('holiday','2028年清明节',date '2028-04-05','lunar',array[date '2028-03-14'])," +
        "('holiday','清明假期活动',date '2026-04-05','solar',array[date '2028-03-14'])," +
        "('birthday','清明',date '2026-04-05','lunar',array[date '2028-03-14'])) " +
        "select anniversary.kind, anniversary.title, anniversary.calendar_type, occurrence.year, occurrence.occurrence_date::text as date, occurrence.source " +
        "from anniversaries anniversary cross join lateral (" +
        "select year.value as year, (" + replacement + ") as occurrence_date, 'solar' as source " +
        "from (values (2027),(2028),(2029)) as year(value) " + solarReplacement +
        " union all select 2028, unnest(anniversary.lunar_occurrence_dates), 'lunar' " + lunarReplacement +
        ") occurrence where " + lowerReplacement + " order by anniversary.kind,anniversary.title,occurrence.year")).rows;
      assertEquals(rows.length, 15);
      for (const row of rows) {
        const isQingming = row.kind === "holiday" && ["清明节", "2026年清明", " 清 明 节 ", "2028年清明节"].includes(row.title);
        if (row.calendar_type === "lunar" && !isQingming) {
          assertEquals(row.source, "lunar");
          assertEquals(row.date, "2028-03-14");
        } else {
          assertEquals(row.source, "solar");
          assertEquals(row.date, row.year + "-04-" + (isQingming && row.year !== 2027 ? "04" : "05"));
        }
      }
      assertEquals(rows.filter((row) => row.title === "2028年清明节").map((row) => row.date), ["2028-04-04", "2029-04-04"]);
    });

    await t.step("reapplying the migration is an exact no-op on the reminder definition and metadata", async () => {
      await db.exec(migration);
      assertEquals(await definition(), after);
      assertEquals(await metadata(), beforeMetadata);
    });

    await t.step("fresh schema installs the identical private date helper", async () => {
      const schema = await Deno.readTextFile(new URL("../../schema.sql", import.meta.url));
      const helperPattern = /create or replace function public\.qingming_date_for_year\(target_year integer\)[\s\S]*?\$qingming\$;/;
      assertEquals(schema.match(helperPattern)?.[0], migration.match(helperPattern)?.[0]);
      assert(schema.includes("revoke all on function public.qingming_date_for_year(integer) from public, anon, authenticated;"));
    });
  } finally {
    await db.close();
  }
});

Deno.test("Qingming migration rejects unknown reminder definitions and preserves the function", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("create role anon; create role authenticated;");
    const migration = await Deno.readTextFile(migrationUrl);
    const definition = async () => (await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.claim_due_reminders(text)'::regprocedure) as definition"
    )).rows[0].definition;
    for (const expression of ["null::date", "public.anniversary_date_for_year(anniversary.date, year.value) " +
      "+ (public.anniversary_date_for_year(anniversary.date, year.value) - anniversary.date)",
      "public.qingming_date_for_year(2028)"]) {
      await db.exec("create or replace function public.claim_due_reminders(dispatcher_token text) " +
        "returns date language plpgsql security definer as $$ begin return " + expression + "; end; $$;");
      const before = await definition();
      await assertRejects(async () => {
        await db.exec("begin");
        try {
          await db.exec(migration);
          await db.exec("commit");
        } catch (error) {
          await db.exec("rollback");
          throw error;
        }
      }, Error, "Qingming reminder migration");
      assertEquals(await definition(), before);
    }
  } finally {
    await db.close();
  }
});
