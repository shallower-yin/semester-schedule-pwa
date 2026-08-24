import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const mirrorScript = readFileSync(resolve(process.cwd(), "scripts/deploy-static-mirror.mjs"), "utf8");
const apkWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/publish-apk-mirror.yml"), "utf8");
const androidBuild = readFileSync(resolve(process.cwd(), "android/app/build.gradle"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("Web 与 APK 发布版本隔离", () => {
  it("APK 清单记录实际打包的版本、提交和更新说明", () => {
    for (const field of ["apkVersion", "apkCommit", "apkTitle", "apkNotes", "apkPublishedAt"]) {
      expect(viteConfig).toContain(field);
      expect(apkWorkflow).toContain(`data["${field}"]`);
      expect(mirrorScript).toContain(`"${field}"`);
    }
  });

  it("新安装包使用高于线上 27 的 versionCode", () => {
    expect(androidBuild).toMatch(/versionCode\s+28\b/);
    expect(androidBuild).toMatch(/versionName\s+"0\.1\.0\.28"/);
  });

  it("只有 Service Worker 待接管时也能进入刷新流程", () => {
    expect(appSource).toContain("if (!release && !needRefresh) return;");
  });
});
