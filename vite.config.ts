import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execFileSync } from "node:child_process";

export default defineConfig(() => {
  const base = process.env.GITHUB_ACTIONS ? "/semester-schedule-pwa/" : "/";
  const releaseDate = process.env.VITE_APP_VERSION_DATE ?? formatShanghaiDate();
  const releaseSequence = process.env.VITE_APP_VERSION_SEQUENCE ?? dailyCommitSequence(releaseDate);
  const appVersion = `${releaseDate}.${releaseSequence}`;
  const appCommit = shortCommitHash();

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_COMMIT__: JSON.stringify(appCommit)
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            dexie: ["dexie", "dexie-react-hooks"],
            supabase: ["@supabase/supabase-js"]
          }
        }
      }
    },
    plugins: [
      react(),
      VitePWA({
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
          start_url: base,
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
          globPatterns: ["**/*.{js,css,html,svg,png}"],
          navigateFallback: "index.html",
          importScripts: ["push-sw.js"]
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
