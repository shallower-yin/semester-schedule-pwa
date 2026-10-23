import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const primary = "https://schedule.nfsg.eu.cc/";
const legacy = "https://haifsnaupqhlvgfoyvlc.supabase.co/functions/v1/app-hosting/";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function validateManifest(value) {
  if (!value || typeof value.version !== "string" || !Array.isArray(value.notes)
    || !Number.isSafeInteger(value.apkVersionCode) || value.apkVersionCode <= 0
    || !/^[a-f0-9]{64}$/i.test(value.apkSha256 || "")
    || !value.apkUrl?.startsWith("https://")) throw new Error("Invalid Android release metadata");
  return value;
}

async function download(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Download HTTP ${response.status}: ${new URL(url).pathname}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { last = error; }
  }
  throw last;
}

async function headers(directory) {
  const file = path.join(directory, "_headers");
  let text = "";
  try { text = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!text.includes("# Android update channel")) {
    text += "\n# Android update channel\n/android/latest.json\n  Cache-Control: no-store\n  Access-Control-Allow-Origin: *\n/android/*.apk\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: ETag, Content-Range, Accept-Ranges\n";
    await writeFile(file, text);
  }
}

/** Preserve the installed channel across a web build; Vite's clean output cannot delete it. */
export async function preserve(directory, fetchBytes = download, includePrevious = true) {
  const manifest = validateManifest(JSON.parse((await fetchBytes(`${primary}android/latest.json?ts=${Date.now()}`)).toString()));
  const expected = new URL(`android/semester-schedule-v${manifest.apkVersionCode}.apk`, primary).href;
  if (manifest.apkUrl !== expected) throw new Error("Published static APK URL is not versioned on the static origin");
  const bytes = await fetchBytes(expected);
  if (sha(bytes) !== manifest.apkSha256) throw new Error("Published static APK SHA-256 mismatch");
  await mkdir(path.join(directory, "android"), { recursive: true });
  await writeFile(path.join(directory, "android", path.basename(new URL(expected).pathname)), bytes);
  await writeFile(path.join(directory, "android/latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (includePrevious && manifest.previousApk) {
    const previous = manifest.previousApk;
    const previousUrl = new URL(`android/semester-schedule-v${previous.apkVersionCode}.apk`, primary).href;
    if (previous.apkUrl !== previousUrl || !/^[a-f0-9]{64}$/i.test(previous.apkSha256 || "")) {
      throw new Error("Invalid previous static APK metadata");
    }
    const previousBytes = await fetchBytes(previousUrl);
    if (sha(previousBytes) !== previous.apkSha256) throw new Error("Previous static APK SHA-256 mismatch");
    await writeFile(path.join(directory, "android", path.basename(new URL(previousUrl).pathname)), previousBytes);
  }
  await headers(directory);
}

/** Stage bytes and a candidate. The currently published latest.json remains untouched. */
export async function prepare(directory, apkPath, releasePath) {
  const release = validateManifest(JSON.parse(await readFile(releasePath, "utf8")));
  const bytes = await readFile(apkPath);
  if (sha(bytes) !== release.apkSha256) throw new Error("Local APK SHA-256 mismatch");
  const web = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
  let current;
  try { current = validateManifest(JSON.parse(await readFile(path.join(directory, "android/latest.json"), "utf8"))); }
  catch (error) { throw new Error("Preserve the current static Android channel before staging a replacement", { cause: error }); }
  if (release.apkVersionCode <= current.apkVersionCode) throw new Error("Android versionCode must increase");
  const file = `semester-schedule-v${release.apkVersionCode}.apk`;
  const apkUrl = new URL(`android/${file}`, primary).href;
  const backup = new URL(`android/semester-schedule.apk?code=${release.apkVersionCode}&sha=${release.apkSha256}`, legacy).href;
  const candidate = {
    ...web,
    apkVersionCode: release.apkVersionCode, apkSha256: release.apkSha256,
    apkVersion: release.apkVersion || release.version, apkCommit: release.apkCommit || release.commit,
    apkTitle: release.apkTitle || release.title, apkNotes: release.apkNotes || release.notes,
    apkPublishedAt: release.apkPublishedAt || release.publishedAt,
    apkUrl, apkUrls: [apkUrl, backup], apkBytes: bytes.length,
    previousApk: {
      apkVersionCode: current.apkVersionCode, apkUrl: current.apkUrl,
      apkSha256: current.apkSha256, apkBytes: current.apkBytes
    }
  };
  await copyFile(apkPath, path.join(directory, "android", file));
  await writeFile(path.join(directory, "android/latest.next.json"), JSON.stringify(candidate, null, 2) + "\n");
  await headers(directory);
  return candidate;
}

/** Run after the asset deployment. Verify public bytes before promoting the manifest. */
export async function verifyRange(url, expected, request = fetch) {
  const head = await request(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const etag = head.headers.get("etag");
  if (!head.ok || !etag || etag.startsWith("W/") || !etag.startsWith('"')
    || Number(head.headers.get("content-length")) !== expected.length) throw new Error("Static APK HEAD/ETag verification failed");
  const end = Math.min(15, expected.length - 1);
  const response = await request(url, { headers: { Range: `bytes=0-${end}`, "If-Range": etag }, signal: AbortSignal.timeout(20_000) });
  const actual = Buffer.from(await response.arrayBuffer());
  if (response.status !== 206 || response.headers.get("content-range") !== `bytes 0-${end}/${expected.length}`
    || response.headers.get("etag") !== etag || !actual.equals(expected.subarray(0, end + 1))) {
    throw new Error("Static APK Range verification failed");
  }
}

export async function promote(directory, fetchBytes = download, rangeVerifier = verifyRange) {
  const candidatePath = path.join(directory, "android/latest.next.json");
  const candidate = validateManifest(JSON.parse(await readFile(candidatePath, "utf8")));
  const bytes = await fetchBytes(candidate.apkUrl);
  if (sha(bytes) !== candidate.apkSha256 || bytes.length !== candidate.apkBytes) {
    throw new Error("Public APK verification failed; latest.json was not changed");
  }
  await rangeVerifier(candidate.apkUrl, bytes);
  await copyFile(candidatePath, path.join(directory, "android/latest.json"));
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.env.STATIC_WEB_DIR || "dist-cloudflare");
  const action = process.argv[2];
  if (action === "preserve") await preserve(directory, download, !process.env.STATIC_PENDING_APK_CODE);
  else if (action === "prepare") await prepare(directory, process.env.APK_SOURCE_PATH, process.env.APK_RELEASE_PATH);
  else if (action === "promote") await promote(directory);
  else throw new Error("Expected preserve, prepare or promote");
  console.log(`Static Android channel ${action} completed`);
}
