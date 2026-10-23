import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

const apkBytes = Buffer.from("signed-release-apk-fixture");
const apkFields = ["apkUrl", "apkVersionCode", "apkSha256", "apkVersion", "apkCommit", "apkTitle", "apkNotes", "apkPublishedAt"];
const previousRelease = {
  version: "2026.10.23.2", commit: "web1234", title: "网页修复", notes: ["现有网页更新说明"],
  publishedAt: "2026-10-23T09:00:00.000Z", appUrl: "https://app.invalid/", customWebField: "preserved",
  apkUrl: "https://mirror.invalid/android/semester-schedule.apk?code=36", apkVersionCode: 36,
  apkSha256: "36".repeat(32), apkVersion: "2026.10.22.1", apkCommit: "old1234",
  apkTitle: "旧版安卓", apkNotes: ["旧版说明"], apkPublishedAt: "2026-10-22T09:00:00.000Z"
};
const nextRelease = {
  version: "2026.10.23.4", commit: "apk1234", title: "安卓更新", notes: ["新版安卓说明"],
  publishedAt: "2026-10-23T11:00:00.000Z", appUrl: "https://app.invalid/",
  apkUrl: "https://mirror.invalid/android/semester-schedule.apk?code=37", apkVersionCode: 37,
  apkSha256: createHash("sha256").update(apkBytes).digest("hex"), apkVersion: "2026.10.23.4", apkCommit: "apk1234",
  apkTitle: "安卓更新", apkNotes: ["新版安卓说明"], apkPublishedAt: "2026-10-23T11:00:00.000Z"
};

// Execute the real script with all filesystem and Storage operations injected.
// No real credentials, network requests or filesystem writes are used.
async function executeMirror(options: {
  apkOnly?: boolean;
  release?: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  extraFile?: string;
  failUpload?: string;
} = {}) {
  const sourceDir = resolve("mock-mirror-output");
  const apkOnly = options.apkOnly ?? true;
  const release = options.release ?? nextRelease;
  const previous = options.previous === undefined ? previousRelease : options.previous;
  const localFiles = new Map<string, string | Buffer>([["release.json", JSON.stringify(release)]]);
  if (apkOnly) localFiles.set("android/semester-schedule.apk", apkBytes);
  else localFiles.set("index.html", "new-web-html");
  if (options.extraFile) localFiles.set(options.extraFile, "unexpected-web-asset");
  const remoteFiles = new Map<string, string | Buffer>([
    ["index.html", "existing-web-html"],
    ["asset-manifest.json", '{"version":"2026.10.23.2","files":["index.html"]}'],
    ["android/semester-schedule.apk", "existing-apk"]
  ]);
  if (previous) remoteFiles.set("release.json", JSON.stringify(previous));
  const initialRemoteFiles = new Map(remoteFiles);
  const objectPath = (path: string) => relative(sourceDir, path).split(sep).join("/");
  const readFile = vi.fn(async (path: string, encoding?: string) => {
    const value = localFiles.get(objectPath(path));
    if (value === undefined) throw new Error(`Missing fixture ${objectPath(path)}`);
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return encoding ? bytes.toString("utf8") : bytes;
  });
  const writeFile = vi.fn(async (path: string, content: string | Buffer) => {
    localFiles.set(objectPath(path), content);
  });
  const readdir = vi.fn(async (directory: string) => {
    const prefix = objectPath(directory);
    const children = new Map<string, boolean>();
    for (const path of localFiles.keys()) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      const suffix = prefix ? path.slice(prefix.length + 1) : path;
      const [name, ...rest] = suffix.split("/");
      children.set(name, rest.length > 0);
    }
    return [...children].map(([name, directoryEntry]) => ({
      name, isDirectory: () => directoryEntry, isFile: () => !directoryEntry
    }));
  });
  const storage = {
    download: vi.fn(async (path: string) => ({
      data: remoteFiles.has(path) ? { text: async () => String(remoteFiles.get(path)) } : null,
      error: remoteFiles.has(path) ? null : new Error("Not found")
    })),
    upload: vi.fn(async (path: string, content: string | Buffer) => {
      if (path === options.failUpload) return { error: new Error("Fixture upload failed") };
      remoteFiles.set(path, content);
      return { error: null };
    }),
    list: vi.fn(async () => ({ data: [], error: null })),
    remove: vi.fn(async () => ({ error: null }))
  };
  const clientStorage = {
    from: vi.fn(() => storage),
    listBuckets: vi.fn(async () => ({ data: [{ id: "app-hosting" }], error: null })),
    createBucket: vi.fn(async () => ({ error: null })),
    updateBucket: vi.fn(async () => ({ error: null }))
  };
  const dependencies = {
    createClient: vi.fn(() => ({ storage: clientStorage })), createHash,
    readFile, readdir, writeFile, extname, join, relative, resolve, sep,
    process: { env: {
      SUPABASE_URL: "https://mock.invalid", SUPABASE_SERVICE_ROLE_KEY: "mock-key-not-a-secret",
      STATIC_SOURCE_DIR: sourceDir, STATIC_APK_ONLY: apkOnly ? "true" : "false"
    } },
    console: { log: vi.fn(), warn: vi.fn() }
  };
  const source = readFileSync(resolve("scripts/deploy-static-mirror.mjs"), "utf8").replace(/^import .*;\r?\n/gm, "");
  const run = new Function(...Object.keys(dependencies), `return (async () => { ${source}\n })();`);
  let error: unknown;
  try { await run(...Object.values(dependencies)); } catch (cause) { error = cause; }
  return { error, storage, clientStorage, writeFile, remoteFiles, initialRemoteFiles, localFiles };
}

describe("APK-only mirror publishing", () => {
  it("updates only APK bytes and fields while preserving all web metadata and assets", async () => {
    const result = await executeMirror();
    expect(result.error).toBeUndefined();
    expect(result.storage.upload.mock.calls.map(([path]) => path)).toEqual(["android/semester-schedule.apk", "release.json"]);
    const expected = { ...previousRelease, ...Object.fromEntries(apkFields.map((field) => [field, nextRelease[field as keyof typeof nextRelease]])) };
    expect(JSON.parse(String(result.remoteFiles.get("release.json")))).toEqual(expected);
    expect(result.remoteFiles.get("android/semester-schedule.apk")).toEqual(apkBytes);
    for (const path of ["index.html", "asset-manifest.json"]) {
      expect(result.remoteFiles.get(path)).toBe(result.initialRemoteFiles.get(path));
    }
    expect(result.writeFile).not.toHaveBeenCalled();
    expect(result.storage.list).not.toHaveBeenCalled();
    expect(result.storage.remove).not.toHaveBeenCalled();
    expect(result.clientStorage.listBuckets).not.toHaveBeenCalled();
    expect(result.clientStorage.updateBucket).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing published web release", options: { previous: null } },
    { name: "invalid published web release", options: { previous: { version: "", notes: [] } } },
    { name: "non-increasing versionCode", options: { release: { ...nextRelease, apkVersionCode: 36 } } },
    { name: "unexpected web file", options: { extraFile: "assets/index.js" } },
    { name: "APK checksum mismatch", options: { release: { ...nextRelease, apkSha256: "00".repeat(32) } } },
    { name: "incomplete APK metadata", options: { release: { ...nextRelease, apkCommit: "" } } }
  ])("rejects $name before any writes", async ({ options }) => {
    const result = await executeMirror(options);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.storage.upload).not.toHaveBeenCalled();
    expect(result.storage.remove).not.toHaveBeenCalled();
    expect(result.remoteFiles).toEqual(result.initialRemoteFiles);
  });

  it("does not publish release metadata when the APK upload fails", async () => {
    const result = await executeMirror({ failUpload: "android/semester-schedule.apk" });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.storage.upload.mock.calls.map(([path]) => path)).toEqual(["android/semester-schedule.apk"]);
    expect(result.remoteFiles).toEqual(result.initialRemoteFiles);
  });

  it("keeps the old manifest if its upload fails after the APK upload", async () => {
    const result = await executeMirror({ failUpload: "release.json" });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.storage.upload.mock.calls.map(([path]) => path)).toEqual(["android/semester-schedule.apk", "release.json"]);
    expect(result.remoteFiles.get("release.json")).toBe(result.initialRemoteFiles.get("release.json"));
    expect(result.remoteFiles.get("asset-manifest.json")).toBe(result.initialRemoteFiles.get("asset-manifest.json"));
    expect(result.storage.remove).not.toHaveBeenCalled();
  });

  it("keeps the existing web deployment path and preserves prior APK fields", async () => {
    const webRelease = Object.fromEntries(Object.entries(nextRelease).filter(([field]) => !apkFields.includes(field)));
    const result = await executeMirror({ apkOnly: false, release: webRelease });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(String(result.remoteFiles.get("release.json")))).toEqual({
      ...webRelease, ...Object.fromEntries(apkFields.map((field) => [field, previousRelease[field as keyof typeof previousRelease]]))
    });
    expect(result.remoteFiles.get("android/semester-schedule.apk")).toBe("existing-apk");
    expect(String(result.remoteFiles.get("index.html"))).toBe("new-web-html");
    expect(JSON.parse(String(result.remoteFiles.get("asset-manifest.json"))).version).toBe(webRelease.version);
    expect(result.clientStorage.updateBucket).toHaveBeenCalledOnce();
  });
});
