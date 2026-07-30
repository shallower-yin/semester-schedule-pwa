import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const accessToken = required("SUPABASE_ACCESS_TOKEN");
const projectRef = required("PROJECT_REF");
const migrationsDir = resolve(process.env.MIGRATIONS_DIR || "supabase/migrations");
const baselineThrough = process.env.MIGRATION_BASELINE_THROUGH?.trim() || "";
const endpoint = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`;

const files = (await readdir(migrationsDir))
  .filter((name) => /^\d{8}_[a-z0-9_]+\.sql$/i.test(name))
  .sort();
if (!files.length) throw new Error(`No SQL migrations found in ${migrationsDir}`);

await execute(`
  create table if not exists public.app_schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
  revoke all on table public.app_schema_migrations from anon, authenticated;
  grant select, insert on table public.app_schema_migrations to service_role;
`);

let applied = new Set((await execute(
  "select name from public.app_schema_migrations order by name;"
)).map((row) => String(row.name)));

// This project already had migrations deployed before tracking existed. On the
// first tracked run only, record the audited production baseline without
// replaying it. New/fresh projects should omit MIGRATION_BASELINE_THROUGH.
if (applied.size === 0 && baselineThrough) {
  const baselineIndex = files.indexOf(baselineThrough);
  if (baselineIndex < 0) throw new Error(`Migration baseline not found: ${baselineThrough}`);
  const baselineFiles = files.slice(0, baselineIndex + 1);
  const values = baselineFiles.map((name) => `('${sqlLiteral(name)}')`).join(",\n");
  await execute(`
    insert into public.app_schema_migrations (name)
    values ${values}
    on conflict (name) do nothing;
  `);
  applied = new Set(baselineFiles);
  console.log(`Recorded existing production baseline through ${baselineThrough}`);
}

for (const name of files) {
  if (applied.has(name)) {
    console.log(`Already applied: ${name}`);
    continue;
  }
  const sql = await readFile(resolve(migrationsDir, name), "utf8");
  // The Management API executes one request transactionally. The advisory lock
  // serializes manual and automatic deploys; the trailing insert is committed
  // only when the migration itself succeeds.
  await execute(`
    select pg_advisory_xact_lock(hashtextextended('semester-schedule-schema-migrations', 0));
    ${sql}
    insert into public.app_schema_migrations (name)
    values ('${sqlLiteral(name)}')
    on conflict (name) do nothing;
  `, 240_000);
  console.log(`Applied: ${name}`);
}

async function execute(query, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase migration query failed (${response.status}): ${text.slice(0, 2000)}`);
    }
    return text ? JSON.parse(text) : [];
  } finally {
    clearTimeout(timer);
  }
}

function sqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
