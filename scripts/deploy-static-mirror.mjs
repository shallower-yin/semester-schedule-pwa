import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile } from "node:fs/promises";
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
    public: false,
    fileSizeLimit: 25 * 1024 * 1024
  });
  if (error) throw error;
} else {
  const { error } = await client.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024
  });
  if (error) throw error;
}

let files = await walk(sourceDir);
const release = JSON.parse(await readFile(join(sourceDir, "release.json"), "utf8"));
const packageFiles = files
  .map((absolutePath) => relative(sourceDir, absolutePath).split(sep).join("/"))
  .filter((objectPath) => objectPath !== "asset-manifest.json")
  .sort();
await writeFile(join(sourceDir, "asset-manifest.json"), JSON.stringify({
  version: String(release.version || ""),
  commit: String(release.commit || ""),
  files: packageFiles
}, null, 2));
files = await walk(sourceDir);
const deployedPaths = new Set();
for (const absolutePath of files) {
  const objectPath = relative(sourceDir, absolutePath).split(sep).join("/");
  deployedPaths.add(objectPath);
  const content = await readFile(absolutePath);
  const cacheControl = /^(asset-manifest\.json|index\.html|sw\.js|release\.json|manifest\.webmanifest)$/.test(objectPath) ? "0" : "31536000";
  const { error } = await client.storage.from(bucket).upload(objectPath, content, {
    upsert: true,
    cacheControl,
    contentType: contentType(objectPath)
  });
  if (error) throw new Error(`Upload ${objectPath} failed: ${error.message}`);
  console.log(`Uploaded ${objectPath}`);
}

const stalePaths = (await listStoredFiles("")).filter((path) => !deployedPaths.has(path));
for (let index = 0; index < stalePaths.length; index += 100) {
  const batch = stalePaths.slice(index, index + 100);
  const { error } = await client.storage.from(bucket).remove(batch);
  if (error) throw new Error(`Remove stale mirror files failed: ${error.message}`);
  for (const objectPath of batch) console.log(`Removed stale ${objectPath}`);
}

console.log(`Mirror files deployed to private Storage bucket: ${bucket}`);

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

async function listStoredFiles(prefix) {
  const result = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) result.push(objectPath);
      else result.push(...await listStoredFiles(objectPath));
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return result;
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
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
