import type { AppRelease } from "./appRelease";
import {
  appMirrorAssetManifestUrl,
  appMirrorAssetUrl
} from "./appHosting";

const RUNTIME_CACHE = "semester-schedule-offline-updates";
const TEMP_CACHE_PREFIX = "semester-schedule-update-";

interface AppAssetManifest {
  version: string;
  commit: string;
  files: string[];
}

export interface OfflineUpdateProgress {
  completed: number;
  total: number;
  file: string;
}

export async function installOfflineAppUpdate(
  release: AppRelease,
  onProgress?: (progress: OfflineUpdateProgress) => void
): Promise<number> {
  if (!("caches" in window)) throw new Error("当前浏览器不支持离线更新缓存。");
  const manifest = await fetchAssetManifest(release.version);
  const files = Array.from(new Set(manifest.files.map(normalizeFilePath).filter(Boolean)));
  if (!files.includes("index.html")) throw new Error("更新包缺少入口文件。");

  const tempCacheName = `${TEMP_CACHE_PREFIX}${release.version}`;
  await caches.delete(tempCacheName);
  const tempCache = await caches.open(tempCacheName);

  try {
    let completed = 0;
    await mapWithConcurrency(files, 4, async (file) => {
      const response = await fetch(`${appMirrorAssetUrl(file)}?version=${encodeURIComponent(release.version)}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`下载 ${file} 失败（${response.status}）。`);
      const targetUrl = new URL(file, document.baseURI).href;
      await tempCache.put(targetUrl, await cleanResponse(response, file));
      completed += 1;
      onProgress?.({ completed, total: files.length, file });
    });

    const runtimeCache = await caches.open(RUNTIME_CACHE);
    for (const request of await runtimeCache.keys()) await runtimeCache.delete(request);

    for (const request of await tempCache.keys()) {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith("/index.html")) continue;
      const response = await tempCache.match(request);
      if (response) await runtimeCache.put(request, response);
    }

    const indexUrl = new URL("index.html", document.baseURI).href;
    const indexResponse = await tempCache.match(indexUrl);
    if (!indexResponse) throw new Error("更新包入口文件读取失败。");
    const replaced = await replacePrecachedIndex(indexUrl, indexResponse);
    if (!replaced) throw new Error("未找到当前应用入口缓存，请联网刷新一次后重试。");
    return files.length;
  } finally {
    await caches.delete(tempCacheName);
  }
}

async function fetchAssetManifest(expectedVersion: string): Promise<AppAssetManifest> {
  const response = await fetch(`${appMirrorAssetManifestUrl}?version=${encodeURIComponent(expectedVersion)}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`获取更新文件清单失败（${response.status}）。`);
  const value = await response.json() as Partial<AppAssetManifest>;
  if (value.version !== expectedVersion || !Array.isArray(value.files)) {
    throw new Error("更新文件清单与版本不匹配，请稍后重试。");
  }
  return {
    version: value.version,
    commit: String(value.commit || ""),
    files: value.files.map(String)
  };
}

async function replacePrecachedIndex(indexUrl: string, response: Response): Promise<boolean> {
  const indexPath = new URL(indexUrl).pathname;
  let replaced = false;
  for (const cacheName of await caches.keys()) {
    if (!cacheName.includes("workbox-precache")) continue;
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname !== indexPath) continue;
      await cache.put(request, response.clone());
      replaced = true;
    }
  }
  return replaced;
}

async function cleanResponse(response: Response, file: string): Promise<Response> {
  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": contentType(file),
      "cache-control": file === "index.html" ? "no-cache" : "public, max-age=31536000, immutable"
    }
  });
}

function contentType(file: string): string {
  const extension = file.split(".").pop()?.toLowerCase() || "";
  return ({
    html: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    webmanifest: "application/manifest+json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    ico: "image/x-icon"
  })[extension] || "application/octet-stream";
}

function normalizeFilePath(file: string): string {
  const normalized = file.trim().replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").some((segment) => segment === "..")) return "";
  return normalized;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}
