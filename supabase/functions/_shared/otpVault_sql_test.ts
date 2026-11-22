import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.test("OTP 密文存储的账号隔离、原子修订号及重复迁移", async () => {
  const db = await PGlite.create();
  const alice = "00000000-0000-0000-0000-000000000001";
  const bob = "00000000-0000-0000-0000-000000000002";
  const payload = { version: 1, kdf: "PBKDF2-SHA256", iterations: 600000, salt: "A".repeat(24), iv: "B".repeat(16), ciphertext: "C".repeat(64) };
  const save = (owner: string, revision: number, value = payload) => db.query<{ revision: string; payload: unknown }>(
    "select * from public.save_otp_vault($1::uuid,$2::bigint,$3::jsonb)", [owner, revision, JSON.stringify(value)]
  );
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to authenticated, anon;
      insert into auth.users values ('${alice}'),('${bob}');
    `);
    const sql = await Deno.readTextFile(new URL("../../migrations/20261122_otp_vaults.sql", import.meta.url));
    await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false)`);
    assertEquals((await save(alice, 0)).rows.length, 1);
    assertEquals((await save(alice, 0)).rows.length, 0);
    assertEquals((await save(alice, 7)).rows.length, 0);
    const second = await save(alice, 1);
    assertEquals(Number(second.rows[0].revision), 2);
    assertEquals(second.rows[0].payload, payload);
    await assertRejects(() => save(bob, 0), Error, "owner mismatch");
    await assertRejects(() => save(alice, -1), Error, "Invalid OTP vault revision");
    await assertRejects(() => save(alice, 2, { ...payload, iterations: 1 }), Error, "Invalid encrypted OTP vault");
    await assertRejects(() => db.query("select * from public.save_otp_vault($1,2,$2)", [alice, JSON.stringify({ ...payload, secret: "plaintext must not be accepted" })]), Error, "Invalid encrypted OTP vault");
    await assertRejects(() => db.exec("update public.otp_vaults set revision=99"), Error, "permission denied");
    await assertRejects(() => db.exec("delete from public.otp_vaults"), Error, "permission denied");
    await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`);
    assertEquals((await db.query("select * from public.otp_vaults")).rows.length, 0);
    await assertRejects(() => save(alice, 2), Error, "owner mismatch");
    assertEquals((await save(bob, 0)).rows.length, 1);
    assertEquals((await db.query("select * from public.otp_vaults")).rows.length, 1);
    await db.exec("reset role");
    await db.exec(sql);
    assertEquals((await db.query("select count(*)::int as count from public.otp_vaults")).rows, [{ count: 2 }]);
    await db.exec("set role anon");
    await assertRejects(() => db.exec("select * from public.otp_vaults"), Error, "permission denied");
    await assertRejects(() => save(alice, 0), Error, "permission denied");
  } finally { await db.close(); }
});
