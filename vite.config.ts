import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const isAndroid = mode === "android";
  const base = isAndroid ? "/" : process.env.VITE_APP_BASE?.trim() || (process.env.GITHUB_ACTIONS ? "/semester-schedule-pwa/" : "/");
  const appStartUrl = process.env.VITE_APP_START_URL?.trim() || base;
  const appUrl = process.env.VITE_APP_URL?.trim() || "";
  const outDir = process.env.VITE_OUT_DIR?.trim() || "dist";
  const releaseDate = process.env.VITE_APP_VERSION_DATE ?? formatShanghaiDate();
  const releaseSequence = process.env.VITE_APP_VERSION_SEQUENCE ?? dailyCommitSequence(releaseDate);
  const appVersion = `${releaseDate}.${releaseSequence}`;
  const appCommit = shortCommitHash();
  assertReleaseNotesMatchCurrentCommit();
  const releaseNotes = loadReleaseNotes();
  const releaseManifest = JSON.stringify({
    version: appVersion,
    commit: appCommit,
    title: releaseNotes.title,
    notes: releaseNotes.notes,
    publishedAt: new Date().toISOString(),
    appUrl
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
          manualChunks: {
            react: ["react", "react-dom"],
            dexie: ["dexie", "dexie-react-hooks"],
            supabase: ["@supabase/supabase-js"],
            icons: ["lucide-react"]
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
          theme_color: "#3157d5",
          background_color: "#f7f8fc",
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
          globPatterns: ["**/*.{js,css,html,svg,png,webp}"],
          navigateFallback: "index.html",
          importScripts: ["push-sw.js"],
          runtimeCaching: [
            {
              urlPattern: new RegExp(`${escapeRegExp(base)}.*\\.(?:css|ico|js|json|mjs|png|svg|webp|webmanifest)$`),
              handler: "CacheFirst",
              options: {
                cacheName: "semester-schedule-offline-updates",
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (!process.env.GITHUB_ACTIONS) return;
  const currentCommit = (process.env.GITHUB_SHA || runGit(["rev-parse", "HEAD"])).trim();
  const releaseNotesCommit = runGit(["log", "-1", "--format=%H", "--", "release-notes.json"]);
  if (!currentCommit || currentCommit === releaseNotesCommit) return;
  throw new Error("release-notes.json 未随当前版本更新，已停止发布，避免向用户展示旧版更新说明。");
}
