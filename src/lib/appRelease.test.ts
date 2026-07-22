import { beforeEach, describe, expect, it } from "vitest";
import { appMirrorApkUrl } from "./appHosting";
import {
  ensureAbsoluteApkUrl,
  shouldShowNativeRelease,
  shouldShowRelease,
  skipReleaseVersion,
  type AppRelease
} from "./appRelease";

const release: AppRelease = {
  version: "2026.07.18.2",
  commit: "abc1234",
  title: "功能更新",
  notes: ["新增功能"],
  publishedAt: "2026-07-18T00:00:00.000Z",
  appUrl: "https://example.com/app/",
  apkUrl: "https://example.com/app/app.apk",
  apkVersionCode: 9
};

describe("版本更新说明", () => {
  beforeEach(() => localStorage.clear());

  it("只对不同于当前版本的新版本显示", () => {
    expect(shouldShowRelease("2026.07.18.1", release)).toBe(true);
    expect(shouldShowRelease("2026.07.18.2", release)).toBe(false);
    expect(shouldShowRelease("2026.07.18.3", release)).toBe(false);
  });

  it("跳过当前版本后不再重复提示", () => {
    skipReleaseVersion(release.version);
    expect(shouldShowRelease("2026.07.18.1", release)).toBe(false);
    expect(shouldShowRelease("2026.07.18.1", { ...release, version: "2026.07.18.3" })).toBe(true);
  });

  it("APK 在 versionCode 更高时提示更新", () => {
    expect(shouldShowNativeRelease({ versionCode: 8, versionName: "0.1.0-dev.8" }, release, "2026.07.18.2")).toBe(true);
    expect(shouldShowNativeRelease({ versionCode: 9, versionName: "0.1.0-dev.9" }, release, "2026.07.18.2")).toBe(false);
    expect(shouldShowNativeRelease({ versionCode: 10, versionName: "0.1.0-dev.10" }, release, "2026.07.18.2")).toBe(false);
  });

  it("APK 与网页版一样：release 版本号更新就弹出公告", () => {
    // Packaged web version behind release.json → same notes dialog as PWA.
    expect(shouldShowNativeRelease(
      { versionCode: 12, versionName: "0.1.0-dev.12" },
      release,
      "2026.07.18.1"
    )).toBe(true);
    // Already on release version and same/newer apk code → no popup.
    expect(shouldShowNativeRelease(
      { versionCode: 9, versionName: "0.1.0-dev.9" },
      release,
      "2026.07.18.2"
    )).toBe(false);
  });

  it("没有 APK 元数据时仍可按网页版本号弹出公告", () => {
    const webOnly = { ...release, apkUrl: undefined, apkVersionCode: undefined };
    expect(shouldShowNativeRelease({ versionCode: 1, versionName: "0.1.0" }, webOnly, "2026.07.18.1")).toBe(true);
    expect(shouldShowNativeRelease({ versionCode: 1, versionName: "0.1.0" }, webOnly, "2026.07.18.2")).toBe(false);
  });

  it("相对 apkUrl 解析为镜像绝对地址", () => {
    const relative = ensureAbsoluteApkUrl({
      ...release,
      apkUrl: "android/semester-schedule.apk"
    });
    expect(relative?.apkUrl).toBe(appMirrorApkUrl);
  });

  it("仅有 apkVersionCode 时补齐默认镜像 APK 地址", () => {
    const codeOnly = ensureAbsoluteApkUrl({
      ...release,
      apkUrl: undefined,
      apkVersionCode: 11
    });
    expect(codeOnly?.apkUrl).toBe(appMirrorApkUrl);
  });
});
