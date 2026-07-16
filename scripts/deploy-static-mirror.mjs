import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const sourceDir = resolve(process.env.STATIC_SOURCE_DIR || "dist-mirror");
const bucket = process.env.STATIC_BUCKET || "app-hosting";
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: buckets, error: listError } = await client.storage.listBuckets();
if (listError) throw listError;
if (!buckets.some((item) => item.id === bucket)) {
  const { error } = await client.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 25 * 1024 * 1024
  });
  if (error) throw error;
} else {
  const { error } = await client.storage.updateBucket(bucket, {
    public: true,
    fileSizeLimit: 25 * 1024 * 1024
  });
  if (error) throw error;
}

const files = await walk(sourceDir);
for (const absolutePath of files) {
  const objectPath = relative(sourceDir, absolutePath).split(sep).join("/");
  const content = await readFile(absolutePath);
  const cacheControl = /^(index\.html|sw\.js|release\.json|manifest\.webmanifest)$/.test(objectPath) ? "0" : "31536000";
  const { error } = await client.storage.from(bucket).upload(objectPath, content, {
    upsert: true,
    cacheControl,
    contentType: contentType(objectPath)
  });
  if (error) throw new Error(`Upload ${objectPath} failed: ${error.message}`);
  console.log(`Uploaded ${objectPath}`);
}

console.log(`Mirror deployed: ${supabaseUrl}/storage/v1/object/public/${bucket}/index.html`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  })[extension] || "application/octet-stream";
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
