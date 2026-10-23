import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { preserve, prepare, promote, verifyRange } from "./static-android-channel.mjs";

const bytes = Buffer.from("complete signed apk fixture 38");
const oldBytes = Buffer.from("complete signed apk fixture 37");
const hash = value => createHash("sha256").update(value).digest("hex");
const previous = {
  version: "2026.10.23.2", notes: [], apkVersionCode: 37,
  apkUrl: "https://schedule.nfsg.eu.cc/android/semester-schedule-v37.apk", apkSha256: hash(oldBytes), apkBytes: oldBytes.length
};
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "semester-static-channel-"));
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: "2026.10.24.1", commit: "new-web", notes: ["web"] }));
  await preserve(directory, async url => url.includes("latest.json") ? Buffer.from(JSON.stringify(previous)) : oldBytes);
  const apk = path.join(directory, "fixture.apk"), release = path.join(directory, "fixture.json");
  await writeFile(apk, bytes);
  await writeFile(release, JSON.stringify({ version: "2026.10.24.2", commit: "new-apk", title: "Update", notes: ["apk"],
    apkVersionCode: 38, apkUrl: "https://backup.test/apk", apkSha256: hash(bytes) }));
  return { directory, apk, release };
}

test("staging preserves web and old latest; verified public bytes precede promotion", async () => {
  const { directory, apk, release } = await fixture();
  const webBefore = await readFile(path.join(directory, "release.json"), "utf8");
  const candidate = await prepare(directory, apk, release);
  assert.equal(candidate.apkVersionCode, 38);
  assert.equal(candidate.commit, "new-web");
  assert.equal(candidate.apkCommit, "new-apk");
  assert.equal(candidate.previousApk.apkVersionCode, 37);
  assert.equal(JSON.parse(await readFile(path.join(directory, "android/latest.json"), "utf8")).apkVersionCode, 37);
  assert.equal(await readFile(path.join(directory, "release.json"), "utf8"), webBefore);
  await assert.rejects(promote(directory, async () => Buffer.from("broken"), async () => {}), /verification failed/);
  assert.equal(JSON.parse(await readFile(path.join(directory, "android/latest.json"), "utf8")).apkVersionCode, 37);
  let rangeChecked = false;
  await promote(directory, async () => bytes, async () => { rangeChecked = true; });
  assert.equal(rangeChecked, true);
  assert.equal(JSON.parse(await readFile(path.join(directory, "android/latest.json"), "utf8")).apkVersionCode, 38);
  assert.deepEqual(await readFile(path.join(directory, "android/semester-schedule-v37.apk")), oldBytes);
  const headers = await readFile(path.join(directory, "_headers"), "utf8");
  assert.match(headers, /Cache-Control: no-store/);
  assert.match(headers, /Access-Control-Allow-Origin: \*/);
});

test("invalid APK hash and non-increasing versions fail before changing latest", async () => {
  const { directory, apk, release } = await fixture();
  await writeFile(apk, "wrong");
  await assert.rejects(prepare(directory, apk, release), /SHA-256 mismatch/);
  await writeFile(apk, bytes);
  const value = JSON.parse(await readFile(release, "utf8")); value.apkVersionCode = 37;
  await writeFile(release, JSON.stringify(value));
  await assert.rejects(prepare(directory, apk, release), /versionCode must increase/);
});

test("public resume check requires exact range, ETag and response bytes", async () => {
  const requester = async (_url, options) => options.method === "HEAD"
    ? new Response(null, { headers: { etag: '"stable"', "content-length": String(bytes.length) } })
    : new Response(bytes.subarray(0, 16), { status: 206, headers: { etag: '"stable"', "content-range": `bytes 0-15/${bytes.length}` } });
  await verifyRange("https://static.test/apk", bytes, requester);
  await assert.rejects(verifyRange("https://static.test/apk", bytes, async (_url, options) => options.method === "HEAD"
    ? requester(_url, options) : new Response(bytes)), /Range verification failed/);
});

test("HEAD without Content-Length still requires exact verified Range totals and bytes", async () => {
  const requester = async (_url, options) => options.method === "HEAD"
    ? new Response(null, { headers: { etag: '"stable"' } })
    : new Response(bytes.subarray(0, 16), { status: 206, headers: { etag: '"stable"', "content-range": `bytes 0-15/${bytes.length}` } });
  await verifyRange("https://static.test/apk", bytes, requester);
  await assert.rejects(verifyRange("https://static.test/apk", bytes, async (_url, options) => options.method === "HEAD"
    ? new Response(null, { headers: { etag: '"stable"', "content-length": String(bytes.length + 1) } })
    : requester(_url, options)), /HEAD\/ETag verification failed/);
  await assert.rejects(verifyRange("https://static.test/apk", bytes, async (_url, options) => options.method === "HEAD"
    ? requester(_url, options)
    : new Response(bytes.subarray(0, 16), { status: 206, headers: { etag: '"stable"', "content-range": `bytes 0-15/${bytes.length + 1}` } })), /Range verification failed/);
});
