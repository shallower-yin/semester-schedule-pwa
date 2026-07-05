import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => {
  const base = process.env.GITHUB_ACTIONS ? "/semester-schedule-pwa/" : "/";
  return {
  base,
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
        theme_color: "#3157d5",
        background_color: "#f7f8fc",
        lang: "zh-CN",
        display: "standalone",
        start_url: base,
        scope: base,
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
