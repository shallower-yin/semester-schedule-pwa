import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const mirrorScript = readFileSync(resolve(process.cwd(), "scripts/deploy-static-mirror.mjs"), "utf8");
const pagesWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy-pages.yml"), "utf8");
const cloudflareConfig = readFileSync(resolve(process.cwd(), "wrangler.pwa.jsonc"), "utf8");
const cloudflareWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy-cloudflare-pwa.yml"), "utf8");
const functionsWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy-supabase-functions.yml"), "utf8");
const apkWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/publish-apk-mirror.yml"), "utf8");
const reminderWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/send-reminders.yml"), "utf8");
const androidBuild = readFileSync(resolve(process.cwd(), "android/app/build.gradle"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const appHostingSource = readFileSync(resolve(process.cwd(), "src/lib/appHosting.ts"), "utf8");
const downloadPage = readFileSync(resolve(process.cwd(), "public/download.html"), "utf8");
const r2Config = readFileSync(resolve(process.cwd(), "scripts/configure-r2.mjs"), "utf8");

const productionAppUrl = "https://schedule.nfsg.eu.cc/";

describe("Web 与 APK 发布版本隔离", () => {
  it("PDF 模块 worker 在首次离线使用前预缓存，单文件上限保持为 3 MiB", () => {
    const globPatterns = viteConfig.match(/globPatterns:\s*\[([^\]]+)\]/)?.[1] ?? "";
    expect(globPatterns).toMatch(/\bjs,mjs,css\b/);
    expect(viteConfig).toMatch(/maximumFileSizeToCacheInBytes:\s*3\s*\*\s*1024\s*\*\s*1024\b/);
  });

  it("APK 清单记录实际打包的版本、提交和更新说明", () => {
    for (const field of ["apkVersion", "apkCommit", "apkTitle", "apkNotes", "apkPublishedAt"]) {
      expect(viteConfig).toContain(field);
      expect(apkWorkflow).toContain(`data["${field}"]`);
      expect(mirrorScript).toContain(`"${field}"`);
    }
  });

  it("新安装包使用高于上一版 38 的 versionCode", () => {
    expect(androidBuild).toMatch(/versionCode\s+39\b/);
    expect(androidBuild).toMatch(/versionName\s+"0\.1\.0\.39"/);
  });

  it("APK版本和更新说明变化不会自动触发网页发布", () => {
    const paths = pagesWorkflow.match(/paths:\s*\n([\s\S]*?)\n\s*workflow_dispatch:/)?.[1] ?? "";
    expect(paths).not.toMatch(/^\s*-\s*["'](?:android\/\*\*|capacitor\.config\.ts|release-notes\.json)["']/m);
    expect(paths).toContain('"src/**"');
    expect(pagesWorkflow).toContain("workflow_dispatch:");
  });

  it("APK流水线只发布安装包元数据并核验网页清单不变", () => {
    expect(apkWorkflow).toContain('STATIC_APK_ONLY: "true"');
    expect(apkWorkflow).toContain("cp dist/release.json dist-mirror/release.json");
    expect(apkWorkflow).toContain("cmp /tmp/published-web-asset-manifest.json /tmp/current-web-asset-manifest.json");
    expect(apkWorkflow).not.toContain("npm run build\n");
  });

  it("APK 发布后下载镜像文件并核对实际 SHA-256", () => {
    expect(apkWorkflow).toContain("EXPECTED_APK_SHA: ${{ steps.apk.outputs.sha }}");
    expect(apkWorkflow).toContain("sha256sum /tmp/published-semester-schedule.apk");
    expect(apkWorkflow).toContain('test "$actual_sha" = "$EXPECTED_APK_SHA"');
  });

  it("APK 发布环境安装当前 Android 36 构建依赖", () => {
    expect(apkWorkflow).toContain("packages: platform-tools build-tools;36.0.0 platforms;android-36");
    expect(apkWorkflow).not.toMatch(/packages: tools\b/);
  });

  it("只有 Service Worker 待接管时也能进入刷新流程", () => {
    expect(appSource).toContain("if (!release && !needRefresh) return;");
  });

  it("生产网页、登录、提醒、下载与上传统一使用自定义域名根路径", () => {
    for (const source of [
      pagesWorkflow,
      functionsWorkflow,
      apkWorkflow,
      reminderWorkflow,
      appHostingSource,
      downloadPage,
      r2Config
    ]) {
      expect(source).toContain(productionAppUrl.replace(/\/$/, ""));
    }
    expect(pagesWorkflow).toContain("VITE_APP_BASE: /semester-schedule-pwa/");
    expect(pagesWorkflow).toContain("VITE_APP_START_URL: /semester-schedule-pwa/");
    expect(pagesWorkflow).toContain("VITE_APP_URL: https://schedule.nfsg.eu.cc/");
    expect(cloudflareConfig).toContain('"pattern": "schedule.nfsg.eu.cc"');
    expect(cloudflareConfig).toContain('"custom_domain": true');
    expect(cloudflareConfig).toContain('"directory": "./dist-cloudflare"');
    expect(cloudflareWorkflow).toContain("npm run build:cloudflare");
    expect(cloudflareWorkflow).toContain("wrangler@4.130.0 deploy --config wrangler.pwa.jsonc");
    expect(viteConfig).not.toContain("/semester-schedule-pwa/");
  });
});
