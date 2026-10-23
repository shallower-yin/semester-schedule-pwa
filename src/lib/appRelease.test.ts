import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appMirrorApkUrl, appStaticReleaseUrl } from "./appHosting";
import {
  appUpdateEntryStatus,
  apkDownloadUrlsForRelease,
  fetchLatestRelease,
  UpdateCheckError,
  clearSkippedRelease,
  apkDownloadUrlForRelease,
  combineLatestReleases,
  ensureAbsoluteApkUrl,
  nativeReleaseDetails,
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
  apkVersionCode: 9,
  apkVersion: "2026.07.18.2",
  apkCommit: "abc1234",
  apkTitle: "安卓更新",
  apkNotes: ["安卓修复"]
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

  it("清除跳过后可再次提示", () => {
    skipReleaseVersion(release.version, release.apkVersionCode);
    expect(shouldShowNativeRelease({ versionCode: 8, versionName: "0.1.0" }, release)).toBe(false);
    clearSkippedRelease();
    expect(shouldShowNativeRelease({ versionCode: 8, versionName: "0.1.0" }, release)).toBe(true);
  });

  it("APK 在 versionCode 更高时提示更新", () => {
    expect(shouldShowNativeRelease({ versionCode: 8, versionName: "0.1.0-dev.8" }, release)).toBe(true);
    expect(shouldShowNativeRelease({ versionCode: 9, versionName: "0.1.0-dev.9" }, release)).toBe(false);
    expect(shouldShowNativeRelease({ versionCode: 10, versionName: "0.1.0-dev.10" }, release)).toBe(false);
  });

  it("网页版本更新但 APK versionCode 没变时不提示安装旧包", () => {
    const webNewerButApkSame = { ...release, version: "2026.07.18.3", apkVersion: "2026.07.18.2" };
    expect(shouldShowNativeRelease(
      { versionCode: 9, versionName: "0.1.0-dev.9" },
      webNewerButApkSame
    )).toBe(false);
  });

  it("仅发布新版APK时不向网页提示更新，但旧APK能发现升级", () => {
    const webOnly = { ...release, apkUrl: undefined, apkVersionCode: undefined, apkVersion: undefined };
    const apkOnly = { ...release, apkVersionCode: 37, apkVersion: "2026.10.23.4", apkCommit: "new-apk" };
    const combined = combineLatestReleases([webOnly, apkOnly]);
    expect(shouldShowRelease(release.version, combined)).toBe(false);
    const native = nativeReleaseDetails(combined);
    expect(native).toMatchObject({ version: "2026.10.23.4", commit: "new-apk", apkVersionCode: 37 });
    expect(shouldShowNativeRelease({ versionCode: 36, versionName: "0.1.0.36" }, native)).toBe(true);
  });

  it("没有 APK 元数据时不向安卓声称存在安装包更新", () => {
    const webOnly = { ...release, apkUrl: undefined, apkVersionCode: undefined };
    expect(shouldShowNativeRelease({ versionCode: 1, versionName: "0.1.0" }, webOnly)).toBe(false);
  });

  it("安卓更新弹窗使用 APK 自己的版本与说明", () => {
    expect(nativeReleaseDetails({ ...release, version: "2026.07.18.3", title: "网页更新" })).toMatchObject({
      version: "2026.07.18.2",
      commit: "abc1234",
      title: "安卓更新",
      notes: ["安卓修复"],
      apkVersionCode: 9
    });
  });

  it("合并来源时保留最新网页版本和最高 versionCode 对应的 APK 元数据", () => {
    const combined = combineLatestReleases([
      { ...release, version: "2026.07.18.3", apkUrl: undefined, apkVersionCode: undefined, apkVersion: undefined },
      { ...release, version: "2026.07.18.2", apkVersionCode: 9, apkVersion: "2026.07.18.2" }
    ]);
    expect(combined).toMatchObject({
      version: "2026.07.18.3",
      apkVersion: "2026.07.18.2",
      apkVersionCode: 9
    });
  });

  it("安装包落后多个版本时直接更新到当前最高 versionCode", () => {
    skipReleaseVersion("2026.07.18.2", 25);
    const combined = combineLatestReleases([
      {
        ...release,
        version: "2026.07.18.4",
        apkUrl: undefined,
        apkVersionCode: undefined,
        apkVersion: undefined
      },
      {
        ...release,
        version: "2026.07.18.3",
        apkVersion: "2026.07.18.3",
        apkVersionCode: 26,
        apkSha256: "26".repeat(32)
      },
      {
        ...release,
        version: "2026.07.18.2",
        apkVersion: "2026.07.18.2",
        apkVersionCode: 25
      }
    ]);
    const latestApk = nativeReleaseDetails(combined);

    expect(latestApk).toMatchObject({
      version: "2026.07.18.3",
      apkVersionCode: 26
    });
    expect(shouldShowNativeRelease(
      { versionCode: 20, versionName: "0.1.0.20" },
      latestApk
    )).toBe(true);
    expect(apkDownloadUrlForRelease(latestApk as AppRelease)).toContain("code=26");
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

  it("APK 下载地址带版本、versionCode 和 sha 参数，避免命中旧安装包缓存", () => {
    const url = apkDownloadUrlForRelease({
      ...release,
      apkSha256: "abcdef1234567890abcdef1234567890"
    });
    expect(url).toContain("https://example.com/app/app.apk?");
    expect(url).toContain("v=2026.07.18.2");
    expect(url).toContain("code=9");
    expect(url).toContain("sha=abcdef1234567890");
  });

  it("区分远端新版本和 Service Worker 待刷新", () => {
    expect(appUpdateEntryStatus({
      updating: false,
      updateMessage: "",
      hasAvailableRelease: false,
      serviceWorkerNeedsRefresh: true
    })).toBe("更新已下载，点击刷新");
    expect(appUpdateEntryStatus({
      updating: false,
      updateMessage: "",
      hasAvailableRelease: true,
      serviceWorkerNeedsRefresh: false
    })).toBe("有新版本，点击更新");
  });
});

describe("远端更新通道", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const valid = { ...release, apkSha256: "ab".repeat(32), apkVersionCode: 38 };

  it("原生检查只请求静态和备用远端，不读取本地捆绑的release.json", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requests.push(url);
      return new Response(JSON.stringify(valid));
    }));
    expect(await fetchLatestRelease({ native: true })).toMatchObject({ apkVersionCode: 38 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(appStaticReleaseUrl);
    expect(requests.every(url => url.startsWith("https://") && !url.includes("localhost"))).toBe(true);
  });

  it("主站返回HTML或坏JSON时使用备用，且不把错误当成最新版本", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      url.startsWith(appStaticReleaseUrl) ? "<html>offline</html>" : JSON.stringify(valid))));
    expect(await fetchLatestRelease({ native: true })).toMatchObject({ apkVersionCode: 38 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>offline</html>")));
    await expect(fetchLatestRelease({ native: true })).rejects.toBeInstanceOf(UpdateCheckError);
  });

  it("全部联网失败只有限重试，并保留端点原因", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetcher);
    const error = await fetchLatestRelease({ native: true }).catch(value => value);
    expect(error).toBeInstanceOf(UpdateCheckError);
    expect(error.failures).toHaveLength(2);
    expect(error.failures[0].endpoint).toBe(appStaticReleaseUrl);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("没有SHA的原生元数据无效，不允许用内置版本兜底误报", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(release))));
    await expect(fetchLatestRelease({ native: true })).rejects.toThrow("检查更新失败");
  });

  it("超时后最多再尝试一次，不永久卡住检查", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const result = fetchLatestRelease({ native: true }).catch(error => error);
    await vi.advanceTimersByTimeAsync(32_001);
    expect(await result).toBeInstanceOf(UpdateCheckError);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("只合并同版本同SHA来源，保留静态主地址并拒绝HTTP下载", () => {
    const combined = combineLatestReleases([
      { ...valid, apkUrl: "https://static.test/v38.apk", apkUrls: ["https://backup.test/v38.apk"] },
      { ...valid, apkUrl: "https://other.test/v38.apk" },
      { ...valid, apkSha256: "cd".repeat(32), apkUrl: "https://wrong.test/v38.apk" }
    ]);
    expect(apkDownloadUrlsForRelease(combined!)).toEqual([
      "https://static.test/v38.apk", "https://backup.test/v38.apk", "https://other.test/v38.apk"
    ]);
    expect(apkDownloadUrlsForRelease({ ...valid, apkUrl: "http://insecure.test/a.apk" })).toEqual([]);
  });
});
