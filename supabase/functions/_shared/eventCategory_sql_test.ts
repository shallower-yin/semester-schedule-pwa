// deno test --no-config --node-modules-dir=none --allow-read --allow-env eventCategory_sql_test.ts
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.test("event category migration preserves history and enforces owner references", async (t) => {
  const db = await PGlite.create();
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  const category = "33333333-3333-4333-8333-333333333333";
  const missing = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`create table categories(id uuid primary key, user_id uuid not null, unique(id,user_id));
      create table events(id text primary key, user_id uuid not null, category_id uuid, title text);`);
    await db.query("insert into categories values ($1,$2)", [category, alice]);
    await db.query("insert into events values ('legacy-missing',$1,$2,'keep missing'),('legacy-cross',$3,$4,'keep cross')", [alice, missing, bob, category]);
    const migration = await Deno.readTextFile(new URL("../../migrations/20261104_event_category_owner.sql", import.meta.url));
    await db.exec(migration);
    await db.exec(migration);
    await t.step("idempotent NOT VALID preserves invalid legacy records and their references", async () => {
      assertEquals((await db.query("select id,category_id,title from events order by id")).rows,
        [{ id: "legacy-cross", category_id: category, title: "keep cross" }, { id: "legacy-missing", category_id: missing, title: "keep missing" }]);
      assertEquals((await db.query("select convalidated from pg_constraint where conname='events_category_owner_fkey'")).rows, [{ convalidated: false }]);
      // Unrelated edits remain possible; an explicit reference repair is allowed.
      await db.exec("update events set title='recoverable' where id='legacy-missing'");
      await db.exec("update events set category_id=null where id='legacy-missing'");
    });
    await t.step("same owner and null allowed; cross-owner and missing rejected", async () => {
      await db.query("insert into events values ('valid',$1,$2,'event'),('none',$1,null,'none')", [alice, category]);
      await assertRejects(() => db.query("insert into events values ('cross',$1,$2,'cross')", [bob, category]), Error, "foreign key");
      await assertRejects(() => db.query("insert into events values ('missing',$1,$2,'missing')", [alice, missing]), Error, "foreign key");
      await assertRejects(() => db.query("update events set category_id=$1 where id='none'", [missing]), Error, "foreign key");
    });
    await t.step("category deletion clears category only and preserves event/owner and invalid history", async () => {
      await db.query("delete from categories where id=$1", [category]);
      assertEquals((await db.query("select user_id,category_id,title from events where id='valid'")).rows,
        [{ user_id: alice, category_id: null, title: "event" }]);
      assertEquals((await db.query("select user_id,category_id from events where id='legacy-cross'")).rows,
        [{ user_id: bob, category_id: category }]);
      assertEquals((await db.query("select count(*)::int as count from events")).rows, [{ count: 4 }]);
    });
    await t.step("fresh-install schema defines the same owner FK and targeted null action", async () => {
      await db.exec("drop table events; drop table categories; create schema auth; create table auth.users(id uuid primary key)");
      const schema = await Deno.readTextFile(new URL("../../schema.sql", import.meta.url));
      for (const table of ["categories", "events"]) {
        const statement = schema.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
        if (!statement) throw new Error(`missing schema table ${table}`);
        await db.exec(statement);
      }
      const constraint = await db.query<{ convalidated: boolean; definition: string }>(
        "select convalidated, pg_get_constraintdef(oid) as definition from pg_constraint where conname='events_category_owner_fkey'");
      assertEquals(constraint.rows[0].convalidated, true);
      assertEquals(constraint.rows[0].definition.includes("ON DELETE SET NULL (category_id)"), true);
    });
  } finally { await db.close(); }
});
