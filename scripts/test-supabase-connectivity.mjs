import dns from "node:dns/promises";
import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  try {
    const text = await readFile(new URL("../.env.local", import.meta.url), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    );
  } catch {
    return {};
  }
}

const localEnvironment = await loadLocalEnvironment();
const projectUrl = process.env.VITE_SUPABASE_URL || localEnvironment.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || localEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!projectUrl || !publishableKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}
const hostname = new URL(projectUrl).hostname;
const networkLabel = process.argv[2] || "unlabeled";

async function timedFetch(path) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${projectUrl}${path}`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.text();
    return {
      status: response.status,
      duration_ms: Date.now() - startedAt,
      body: body.slice(0, 300)
    };
  } catch (error) {
    return {
      status: 0,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const result = {
  test: "semester-schedule-supabase-connectivity",
  tested_at: new Date().toISOString(),
  network_label: networkLabel,
  project_host: hostname,
  dns: null,
  auth: null,
  rest: null,
  passed: false
};

try {
  result.dns = await dns.lookup(hostname, { all: true });
} catch (error) {
  result.dns = { error: error instanceof Error ? error.message : String(error) };
}

result.auth = await timedFetch("/auth/v1/health");
result.rest = await timedFetch("/rest/v1/codex_connectivity_probe?select=id&limit=1");

const restKeyAccepted =
  result.rest.status === 404 &&
  typeof result.rest.body === "string" &&
  result.rest.body.includes("PGRST205");

result.passed = result.auth.status === 200 && restKeyAccepted;

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.passed ? 0 : 1;
