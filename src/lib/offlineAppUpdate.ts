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

/**
 * Install mirror assets into the current origin's Cache Storage.
 * Puts every file into both workbox precache and the runtime offline cache so
 * a soft reload cannot mix old precached chunks with a new index (white screen).
 */
export async function installOfflineAppUpdate(
  release: AppRelease,
  onProgress?: (progress: OfflineUpdateProgress) => void
): Promise<number> {
  if (!("caches" in window)) throw new Error("当前浏览器不支持离线更新缓存。");
  const manifest = await fetchAssetManifest(release.version);
  const files = Array.from(new Set(
    manifest.files
      .map(normalizeFilePath)
      .filter((file): file is string => Boolean(file) && isInstallableWebAsset(file))
  ));
  if (!files.includes("index.html")) throw new Error("更新包缺少入口文件。");

  const appBase = resolveAppBasePath();
  const tempCacheName = `${TEMP_CACHE_PREFIX}${release.version}`;
  await caches.delete(tempCacheName);
  const tempCache = await caches.open(tempCacheName);
  const installed = new Map<string, Response>();

  try {
    let completed = 0;
    await mapWithConcurrency(files, 4, async (file) => {
      const response = await fetch(`${appMirrorAssetUrl(file)}?version=${encodeURIComponent(release.version)}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`下载 ${file} 失败（${response.status}）。`);
      const targetUrl = new URL(file, document.baseURI).href;
      const cleaned = await cleanResponse(response, file, appBase);
      await tempCache.put(targetUrl, cleaned.clone());
      installed.set(targetUrl, cleaned);
      completed += 1;
      onProgress?.({ completed, total: files.length, file });
    });

    const indexUrl = new URL("index.html", document.baseURI).href;
    const indexResponse = installed.get(indexUrl) ?? await tempCache.match(indexUrl);
    if (!indexResponse) throw new Error("更新包入口文件读取失败。");
    const indexHtml = await indexResponse.clone().text();
    assertIndexMatchesAppBase(indexHtml, appBase);

    // Refresh runtime cache with the full package.
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    for (const request of await runtimeCache.keys()) await runtimeCache.delete(request);
    for (const [url, response] of installed) {
      if (url === indexUrl || new URL(url).pathname.endsWith("/index.html")) continue;
      await runtimeCache.put(url, response.clone());
    }

    // Also rewrite workbox precache so navigation + modules share one consistent generation.
    const precacheReady = await replacePrecachePackage(installed, indexUrl);
    if (!precacheReady) throw new Error("未找到当前应用入口缓存，请联网刷新一次后重试。");
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
  if (!Array.isArray(value.files) || !value.files.length) {
    throw new Error("更新文件清单无效，请稍后重试。");
  }
  const version = typeof value.version === "string" && value.version.trim()
    ? value.version.trim()
    : expectedVersion;
  return {
    version,
    commit: String(value.commit || ""),
    files: value.files.map(String)
  };
}

async function replacePrecachePackage(installed: Map<string, Response>, indexUrl: string): Promise<boolean> {
  const indexPath = new URL(indexUrl).pathname;
  let replaced = false;
  for (const cacheName of await caches.keys()) {
    if (!cacheName.includes("workbox-precache")) continue;
    const cache = await caches.open(cacheName);
    // Drop stale hashed modules from previous generations.
    for (const request of await cache.keys()) {
      const pathname = new URL(request.url).pathname;
      if (/\.(?:js|mjs|css|html|webmanifest)$/i.test(pathname) || pathname.endsWith("/")) {
        await cache.delete(request);
      }
    }
    for (const [url, response] of installed) {
      await cache.put(url, response.clone());
      if (new URL(url).pathname === indexPath || url === indexUrl) replaced = true;
    }
    // Ensure navigation fallback can resolve the current entry path variants.
    const indexResponse = installed.get(indexUrl);
    if (indexResponse) {
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname === indexPath) {
          await cache.put(request, indexResponse.clone());
          replaced = true;
        }
      }
      // If workbox used a revisioned index key that was deleted, re-seed a plain entry.
      if (!(await cache.match(indexUrl))) {
        await cache.put(indexUrl, indexResponse.clone());
        replaced = true;
      }
    }
  }
  return replaced;
}

async function cleanResponse(response: Response, file: string, appBase: string): Promise<Response> {
  const type = contentType(file);
  if (shouldRewriteTextAsset(file)) {
    let text = await response.text();
    // Mirror already ships GitHub Pages base — only rewrite root-absolute packages.
    if (needsBaseRewrite(text, appBase)) {
      text = rewriteRootAbsolutePaths(text, appBase);
    }
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": file === "index.html" ? "no-cache" : "public, max-age=31536000, immutable"
      }
    });
  }
  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": file === "index.html" ? "no-cache" : "public, max-age=31536000, immutable"
    }
  });
}

/** App pathname base, e.g. "/semester-schedule-pwa/" on GitHub Pages or "/" for root hosts. */
export function resolveAppBasePath(): string {
  const fromEnv = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? String(import.meta.env.BASE_URL)
    : "";
  if (fromEnv && fromEnv !== "./") {
    return fromEnv.endsWith("/") ? fromEnv : `${fromEnv}/`;
  }
  try {
    const path = new URL(".", document.baseURI).pathname;
    return path.endsWith("/") ? path : `${path}/`;
  } catch {
    return "/";
  }
}

export function needsBaseRewrite(content: string, appBase: string): boolean {
  if (!appBase || appBase === "/") return false;
  const basePrefix = appBase.endsWith("/") ? appBase.slice(0, -1) : appBase;
  // Already correctly based HTML/JS — leave alone (avoids double-prefix corruption).
  if (content.includes(`${basePrefix}/assets/`)) return false;
  return /(?:src|href)=["']\/(?!\/)/i.test(content) || /["'`]\/assets\//.test(content);
}

/**
 * Mirror builds often use base "/". When the live app lives under a subpath
 * (GitHub Pages), rewrite root-absolute asset URLs so scripts/CSS resolve.
 */
export function rewriteRootAbsolutePaths(content: string, appBase: string): string {
  if (!appBase || appBase === "/") return content;
  const base = appBase.endsWith("/") ? appBase : `${appBase}/`;
  const baseWithoutSlash = base.slice(0, -1);
  const baseBody = baseWithoutSlash.replace(/^\//, "");
  if (!baseBody) return content;
  const pattern = new RegExp(
    `([("'=\`\\(])\\/(?!\\/|${escapeRegExp(baseBody)}(?:\\/|"|'|\`|\\)|$))`,
    "g"
  );
  return content.replace(pattern, `$1${base}`);
}

export function assertIndexMatchesAppBase(html: string, appBase: string): void {
  const base = (!appBase || appBase === "/") ? "/" : (appBase.endsWith("/") ? appBase : `${appBase}/`);
  const refs = Array.from(html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)).map((match) => match[1]);
  const localAssets = refs.filter((ref) => {
    if (!ref || ref.startsWith("data:") || ref.startsWith("blob:")) return false;
    if (/^https?:\/\//i.test(ref) || ref.startsWith("//")) return false;
    return /\.(?:js|mjs|css|webmanifest)(?:\?|#|$)/i.test(ref) || ref.includes("/assets/");
  });
  if (!localAssets.length) {
    throw new Error("更新入口未包含可用脚本或样式，已中止以免白屏。");
  }
  if (base === "/") return;
  const basePrefix = base.replace(/\/$/, "");
  for (const ref of localAssets) {
    if (!ref.startsWith("/")) continue;
    if (ref === basePrefix || ref.startsWith(`${basePrefix}/`)) continue;
    throw new Error(`更新入口资源路径与当前站点不匹配（${ref}），已中止以免白屏。请使用强制重新加载后重试。`);
  }
}

function shouldRewriteTextAsset(file: string): boolean {
  return /\.(html|js|mjs|css|json|webmanifest|svg)$/i.test(file) || file === "manifest.webmanifest";
}

function isInstallableWebAsset(file: string): boolean {
  if (/\.apk$/i.test(file)) return false;
  if (file === "sw.js" || /^workbox-.*\.js$/i.test(file)) return false;
  if (file.startsWith("android/")) return false;
  return true;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
