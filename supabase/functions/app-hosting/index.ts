const bucket = "app-hosting";
const functionName = "app-hosting";
const supabaseUrl = requiredSecret("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");

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

  const objectPath = resolveObjectPath(new URL(request.url).pathname);
  if (!objectPath) {
    return new Response("Invalid path", {
      status: 400,
      headers: {
        ...corsHeaders(),
        "content-type": "text/plain; charset=utf-8"
      }
    });
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
  if (/^(asset-manifest\.json|index\.html|sw\.js|release\.json|manifest\.webmanifest)$/.test(path) || path.endsWith(".apk")) {
    return "no-store, max-age=0";
  }
  return "public, max-age=31536000, immutable";
}

function contentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return ({
    html: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    apk: "application/vnd.android.package-archive",
    webmanifest: "application/manifest+json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
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
