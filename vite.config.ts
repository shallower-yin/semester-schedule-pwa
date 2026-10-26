import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ command, mode }) => {
  const publicBuildEnv = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  if (command === "build" && process.env.REQUIRE_RELEASE_NOTES === "true") {
    assertCloudBuildConfiguration(publicBuildEnv);
  }
  const isAndroid = mode === "android";
  const base = isAndroid ? "/" : process.env.VITE_APP_BASE?.trim() || "/";
  const appStartUrl = process.env.VITE_APP_START_URL?.trim() || base;
  const appUrl = process.env.VITE_APP_URL?.trim() || "";
  const outDir = process.env.VITE_OUT_DIR?.trim() || "dist";
  const releaseDate = process.env.VITE_APP_VERSION_DATE ?? formatShanghaiDate();
  const releaseSequence = process.env.VITE_APP_VERSION_SEQUENCE ?? dailyCommitSequence(releaseDate);
  const appVersion = `${releaseDate}.${releaseSequence}`;
  const appCommit = shortCommitHash();
  assertReleaseNotesMatchCurrentCommit();
  const releaseNotes = loadReleaseNotes();
  const apkVersionCode = Number(process.env.VITE_APK_VERSION_CODE || "");
  const apkSha256 = process.env.VITE_APK_SHA256?.trim().toLowerCase() || "";
  const publishedAt = new Date().toISOString();
  const apkUrl = process.env.VITE_APK_URL?.trim()
    || (Number.isFinite(apkVersionCode) && apkVersionCode > 0
      ? "https://haifsnaupqhlvgfoyvlc.supabase.co/functions/v1/app-hosting/android/semester-schedule.apk"
      : "");
  const releaseManifest = JSON.stringify({
    version: appVersion,
    commit: appCommit,
    title: releaseNotes.title,
    notes: releaseNotes.notes,
    publishedAt,
    appUrl,
    ...(Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? {
      apkVersionCode,
      apkUrl,
      apkVersion: appVersion,
      apkCommit: appCommit,
      apkTitle: releaseNotes.title,
      apkNotes: releaseNotes.notes,
      apkPublishedAt: publishedAt,
      ...(apkSha256 ? { apkSha256 } : {})
    } : {})
  }, null, 2);

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_COMMIT__: JSON.stringify(appCommit),
      __APP_TARGET__: JSON.stringify(isAndroid ? "android" : "web")
    },
    build: {
      outDir,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) return "react";
            if (/[\\/]node_modules[\\/](?:dexie|dexie-react-hooks)[\\/]/.test(id)) return "dexie";
            if (id.includes(`${resolve("node_modules", "@supabase").replace(/\\/g, "/")}/`) || id.includes("/node_modules/@supabase/")) return "supabase";
            if (id.includes("/node_modules/lucide-react/") || id.includes("\\node_modules\\lucide-react\\")) return "icons";
            return undefined;
          }
        }
      }
    },
    plugins: [
      react(),
      {
        name: "release-manifest",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] !== "/release.json") return next();
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.setHeader("cache-control", "no-store");
            response.end(releaseManifest);
          });
        },
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "release.json", source: releaseManifest });
        }
      },
      VitePWA({
        disable: isAndroid,
        registerType: "prompt",
        includeAssets: ["favicon.svg", "app-icon-192.png", "app-icon-512.png", "push-sw.js"],
        manifest: {
          name: "日程计划表",
          short_name: "日程计划表",
          description: "本地优先、可离线使用的学期课程与事项日程",
          id: base,
          theme_color: "#eef7ff",
          background_color: "#eef7ff",
          lang: "zh-CN",
          display: "standalone",
          start_url: appStartUrl,
          scope: base,
          launch_handler: {
            client_mode: ["navigate-existing", "auto"]
          },
          icons: [
            {
              src: "app-icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any"
            },
            {
              src: "app-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable"
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,mjs,css,html,svg,png,webp}"],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: "index.html",
          importScripts: ["push-sw.js"],
          runtimeCaching: [
            {
              // Workbox serializes this callback into sw.js: keep it closure-free.
              urlPattern: ({ url, request, sameOrigin }) => {
                const scope = new URL((self as unknown as { registration: { scope: string } }).registration.scope);
                if (!sameOrigin || url.origin !== scope.origin || url.search || request.headers.has("authorization")) return false;
                if (!url.pathname.startsWith(scope.pathname)) return false;
                const path = url.pathname.slice(scope.pathname.length);
                return /^(?:assets\/[^/]+\.(?:css|js|mjs|png|svg|webp|woff2?)|focus\/focus-bg-[1-4]\.webp|favicon\.svg|app-icon(?:-192|-512)?\.(?:png|svg)|manifest\.webmanifest)$/.test(path);
              },
              handler: "CacheFirst",
              options: {
                cacheName: `semester-schedule-offline-updates-v2-${encodeURIComponent(new URL(base, "https://app.invalid/").pathname)}`,
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: true
        }
      })
    ]
  };
});

function assertCloudBuildConfiguration(env: Record<string, string | undefined>): void {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const invalid: string[] = [];
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.hostname === "your-project-ref.supabase.co") {
      invalid.push("VITE_SUPABASE_URL");
    }
  } catch {
    invalid.push("VITE_SUPABASE_URL");
  }
  if (!key || key === "sb_publishable_your_key" || key.startsWith("sb_secret_")) {
    invalid.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  } else {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "service_role") invalid.push("VITE_SUPABASE_PUBLISHABLE_KEY");
    } catch {
      // Publishable keys do not use the legacy JWT format.
    }
  }
  if (invalid.length) {
    throw new Error(`发布构建缺少有效云端配置：${invalid.join("、")}。已停止构建。`);
  }
}

function formatShanghaiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}.${value("month")}.${value("day")}`;
}

function dailyCommitSequence(releaseDate: string): string {
  const [year, month, day] = releaseDate.split(".").map(Number);
  if (!year || !month || !day) return "1";
  const start = `${pad(year)}-${pad(month)}-${pad(day)} 00:00:00 +0800`;
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = `${pad(nextDate.getUTCFullYear())}-${pad(nextDate.getUTCMonth() + 1)}-${pad(nextDate.getUTCDate())} 00:00:00 +0800`;
  const count = runGit(["rev-list", "--count", `--since=${start}`, `--until=${end}`, "HEAD"]);
  const numeric = Number(count);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "1";
}

function shortCommitHash(): string {
  return (process.env.GITHUB_SHA?.slice(0, 7) || runGit(["rev-parse", "--short=7", "HEAD"]) || "local").trim();
}

function runGit(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function loadReleaseNotes(): { title: string; notes: string[] } {
  try {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), "release-notes.json"), "utf8")) as { title?: unknown; notes?: unknown };
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "版本更新",
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).filter(Boolean).slice(0, 12) : []
    };
  } catch {
    return { title: "版本更新", notes: ["优化应用体验并修复已知问题。"] };
  }
}

function assertReleaseNotesMatchCurrentCommit() {
  // CI/test builds do not publish release metadata. Deployment workflows opt
  // in explicitly so pull requests and merge commits are never rejected only
  // because their HEAD is not the last notes-editing commit.
  if (process.env.REQUIRE_RELEASE_NOTES !== "true") return;
  const currentCommit = (process.env.GITHUB_SHA || runGit(["rev-parse", "HEAD"])).trim();
  const pushBase = (process.env.GITHUB_EVENT_BEFORE || "").trim();
  if (/^[0-9a-f]{40}$/i.test(pushBase) && !/^0+$/.test(pushBase)) {
    const changedInPush = runGit(["diff", "--name-only", pushBase, currentCommit, "--", "release-notes.json"]).trim();
    if (changedInPush === "release-notes.json") return;
    throw new Error("release-notes.json 未包含在本次发布提交范围内，已停止发布。");
  }
  const releaseNotesCommit = runGit(["log", "-1", "--format=%H", "--", "release-notes.json"]);
  if (!currentCommit || currentCommit === releaseNotesCommit) return;
  throw new Error("release-notes.json 未随当前版本更新，已停止发布，避免向用户展示旧版更新说明。");
}
