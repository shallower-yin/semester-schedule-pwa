const bucket = "app-hosting";
const functionName = "app-hosting";
const supabaseUrl = requiredSecret("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
const githubPagesBase = "https://shallower-yin.github.io/semester-schedule-pwa/";

/**
 * Supabase hosted Edge Functions rewrite GET text/html → text/plain (anti-phishing)
 * on *.supabase.co unless a custom domain is used:
 * https://supabase.com/docs/guides/functions/limits
 *
 * Browser navigation to *.html would otherwise show raw source with mojibake.
 * Document navigations get a UTF-8 plain-text landing with tappable APK/web links.
 * OTA asset fetch (Accept: star/star, Sec-Fetch-Mode: cors) still receives the raw HTML
 * body so client cleanResponse() can restore Content-Type in Cache Storage.
 */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        ...corsHeaders(),
        "content-type": "text/plain; charset=utf-8",
        "allow": "GET, HEAD, OPTIONS"
      }
    });
  }

  const requestUrl = new URL(request.url);
  const objectPath = resolveObjectPath(requestUrl.pathname);
  if (!objectPath) {
    return new Response("Invalid path", {
      status: 400,
      headers: {
        ...corsHeaders(),
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  if (
    request.method === "GET" &&
    isHtmlPath(objectPath) &&
    isBrowserDocumentRequest(request) &&
    !requestUrl.searchParams.has("raw")
  ) {
    return serveHtmlDocumentNavigation(requestUrl, objectPath);
  }

  const response = await fetchStorageObject(objectPath);
  if (!response.ok) {
    return new Response(response.status === 404 ? "Not found" : "Static app unavailable", {
      status: response.status === 404 ? 404 : 502,
      headers: {
        ...corsHeaders(),
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const headers = new Headers(corsHeaders());
  headers.set("content-type", contentType(objectPath));
  headers.set("cache-control", cacheControl(objectPath));
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "frame-ancestors 'self'");
  const contentLength = response.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new Response(request.method === "HEAD" ? null : response.body, {
    status: 200,
    headers
  });
});

async function serveHtmlDocumentNavigation(requestUrl: URL, objectPath: string): Promise<Response> {
  const mirrorBase = `${requestUrl.origin}/functions/v1/${functionName}/`;

  // Custom domain: platform allows real text/html from Edge Functions.
  if (hostAllowsHtml(requestUrl.hostname)) {
    const stored = await fetchStorageObject(objectPath);
    if (stored.ok) {
      const headers = new Headers(corsHeaders());
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "no-store, max-age=0");
      headers.set("x-content-type-options", "nosniff");
      headers.set("content-security-policy", "frame-ancestors 'self'");
      return new Response(stored.body, { status: 200, headers });
    }
  }

  const release = await fetchReleaseJson();
  const body = objectPath === "download.html" || objectPath.endsWith("/download.html")
    ? buildDownloadLandingText(mirrorBase, release)
    : buildGenericHtmlLandingText(objectPath, mirrorBase, release);

  const headers = new Headers(corsHeaders());
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("link", `<${githubPagesBase}download.html>; rel="alternate"; type="text/html"`);

  return new Response(body, { status: 200, headers });
}

function buildDownloadLandingText(mirrorBase: string, release: ReleaseInfo | null): string {
  const version = release?.version || "—";
  const title = release?.title || "日程计划表";
  const apkUrl = resolveApkUrl(release, mirrorBase);
  const webUrl = (release?.appUrl || githubPagesBase).replace(/\/?$/, "/");
  const notes = Array.isArray(release?.notes) ? release!.notes! : [];
  const published = formatPublished(release?.publishedAt);
  const code = release?.apkVersionCode != null ? String(release.apkVersionCode) : "—";

  const noteLines = notes.length
    ? notes.map((n, i) => `  ${i + 1}. ${n}`).join("\n")
    : "  （暂无更新说明）";

  return [
    "══════════════════════════════════════",
    "  日程计划表",
    "  跨端日程 · 网页版与 Android APK 同步分发",
    "══════════════════════════════════════",
    "",
    `版本：${version}`,
    `APK versionCode：${code}`,
    published ? `发布：${published}` : null,
    title && title !== "日程计划表" ? `更新标题：${title}` : null,
    "",
    "【下载 Android APK · 无需梯子】",
    apkUrl,
    "",
    "安装提示：Android 8.0+；下载后允许「未知来源」安装即可。",
    "",
    "【打开网页版】",
    webUrl,
    "（若 GitHub Pages 在当前网络不可用，请直接使用上方 APK）",
    "",
    "【图文完整介绍页】",
    `${webUrl}download.html`,
    "",
    "【本次更新】",
    noteLines,
    "",
    "——",
    "说明：当前地址是 Supabase 镜像（国内可直连下载 APK / 离线包）。",
    "Supabase 默认禁止在 Edge Function 域名下直接渲染 HTML，因此这里显示为纯文本指引，",
    "避免浏览器把网页源码当「乱码」展示。APK 链接可点击或复制到系统浏览器下载。",
    `镜像根路径：${mirrorBase}`,
    ""
  ].filter((line) => line !== null).join("\n");
}

function buildGenericHtmlLandingText(
  objectPath: string,
  mirrorBase: string,
  release: ReleaseInfo | null
): string {
  const webUrl = (release?.appUrl || githubPagesBase).replace(/\/?$/, "/");
  const apkUrl = resolveApkUrl(release, mirrorBase);
  return [
    "日程计划表 · 静态镜像",
    "",
    `请求文件：${objectPath}`,
    "",
    "此镜像用于 APK 分发与离线资源更新，浏览器直接打开 HTML 不会渲染页面",
    "（Supabase Edge Function 平台限制）。",
    "",
    "请使用：",
    `· 网页版：${webUrl}`,
    `· Android APK：${apkUrl}`,
    `· 介绍下载页：${mirrorBase}download.html`,
    ""
  ].join("\n");
}

interface ReleaseInfo {
  version?: string;
  title?: string;
  notes?: string[];
  publishedAt?: string;
  appUrl?: string;
  apkUrl?: string;
  apkVersionCode?: number;
}

async function fetchReleaseJson(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetchStorageObject("release.json");
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === "object" ? data as ReleaseInfo : null;
  } catch {
    return null;
  }
}

function resolveApkUrl(release: ReleaseInfo | null, mirrorBase: string): string {
  const raw = typeof release?.apkUrl === "string" ? release.apkUrl.trim() : "";
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  if (raw) {
    try {
      return new URL(raw.replace(/^\/+/, ""), mirrorBase).href;
    } catch {
      /* fall through */
    }
  }
  return new URL("android/semester-schedule.apk", mirrorBase).href;
}

function formatPublished(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  } catch {
    return iso;
  }
}

/** True when platform allows Edge Function text/html (custom domain / local). */
function hostAllowsHtml(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith(".supabase.co")) return false;
  if (host.endsWith(".supabase.in")) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return true;
}

/**
 * Browser top-level navigation (or iframe) — not OTA asset fetch.
 * Offline updater uses fetch() with Accept: star/star and Sec-Fetch-Mode: cors.
 */
function isBrowserDocumentRequest(request: Request): boolean {
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "document" || dest === "iframe" || dest === "frame" || dest === "embed") {
    return true;
  }
  const mode = (request.headers.get("sec-fetch-mode") || "").toLowerCase();
  if (mode === "navigate") return true;

  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (!accept || accept === "*/*") return false;
  const first = accept.split(",")[0]?.trim() || "";
  return first.startsWith("text/html") || first.startsWith("application/xhtml+xml");
}

function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

async function fetchStorageObject(objectPath: string): Promise<Response> {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  return fetch(`${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encodedPath}`, {
    headers: {
      "authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey
    }
  });
}

function resolveObjectPath(pathname: string): string | null {
  const marker = `/${functionName}`;
  const markerIndex = pathname.indexOf(marker);
  const rawPath = markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath).replace(/^\/+/, "") || "index.html";
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.split("/").some((segment) => segment === "..")) return null;
  return decoded;
}

function cacheControl(path: string): string {
  if (
    /^(asset-manifest\.json|index\.html|download\.html|sw\.js|release\.json|manifest\.webmanifest)$/.test(path) ||
    path.endsWith(".apk")
  ) {
    return "no-store, max-age=0";
  }
  return "public, max-age=31536000, immutable";
}

function contentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return ({
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    apk: "application/vnd.android.package-archive",
    webmanifest: "application/manifest+json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    webp: "image/webp",
    ico: "image/x-icon",
    map: "application/json; charset=utf-8",
    wasm: "application/wasm",
    woff: "font/woff",
    woff2: "font/woff2"
  })[extension] || "application/octet-stream";
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}
