import { appMirrorApkPath, appMirrorApkUrl, appMirrorReleaseUrl, appStaticReleaseUrl, resolveReleaseApkUrl } from "./appHosting";

export interface AppRelease {
  version: string;
  commit: string;
  title: string;
  notes: string[];
  publishedAt: string;
  appUrl: string;
  /** HTTPS URL of a signed APK for in-app sideload updates (Android only). */
  apkUrl?: string;
  apkUrls?: string[];
  /** Must be greater than the installed versionCode for Android to accept the update. */
  apkVersionCode?: number;
  /** Optional lowercase hex SHA-256 of the APK file. */
  apkSha256?: string;
  /** Web bundle version actually packaged inside the published APK. */
  apkVersion?: string;
  apkCommit?: string;
  apkTitle?: string;
  apkNotes?: string[];
  apkPublishedAt?: string;
}

const SKIPPED_RELEASE_KEY = "semester-schedule-skipped-release";
const SKIPPED_APK_CODE_KEY = "semester-schedule-skipped-apk-code";

export class UpdateCheckError extends Error {
  constructor(public readonly failures: { endpoint: string; reason: string }[]) {
    super("检查更新失败，请检查网络后重试。");
    this.name = "UpdateCheckError";
  }
}

export async function fetchLatestRelease(options: { native?: boolean } = {}): Promise<AppRelease | null> {
  const candidates = Array.from(new Set([
    ...(!options.native ? [new URL("release.json", document.baseURI).href] : []),
    appStaticReleaseUrl,
    appMirrorReleaseUrl
  ]));
  if (options.native) {
    const failures: { endpoint: string; reason: string }[] = [];
    for (const endpoint of candidates) {
      try { return await fetchRelease(endpoint, true); }
      catch (error) { failures.push({ endpoint, reason: error instanceof Error ? error.message : String(error) }); }
    }
    throw new UpdateCheckError(failures);
  }
  const results = await Promise.allSettled(candidates.map(url => fetchRelease(url, Boolean(options.native))));
  const releases = results
    .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (!releases.length) throw new UpdateCheckError(results.flatMap((result, index) =>
    result.status === "rejected" ? [{ endpoint: candidates[index], reason: String(result.reason?.message || result.reason) }] : []));

  return combineLatestReleases(releases);
}

export function shouldShowRelease(currentVersion: string, release: AppRelease | null): release is AppRelease {
  if (!release || compareVersions(release.version, currentVersion) <= 0) return false;
  return localStorage.getItem(SKIPPED_RELEASE_KEY) !== release.version;
}

/**
 * Android can only install a package whose native versionCode is newer.
 * A newer web release that still points to the installed APK must never show as an APK update.
 */
export function shouldShowNativeRelease(
  installed: { versionCode: number; versionName: string },
  release: AppRelease | null
): release is AppRelease {
  if (!release) return false;
  const apkCode = release.apkVersionCode;
  if (typeof apkCode !== "number" || !Number.isFinite(apkCode)) return false;
  if (localStorage.getItem(SKIPPED_APK_CODE_KEY) === String(apkCode)) return false;
  return apkCode > installed.versionCode;
}

export function nativeReleaseDetails(release: AppRelease | null): AppRelease | null {
  if (!release || (!release.apkUrl && !release.apkVersionCode)) return null;
  return ensureAbsoluteApkUrl({
    ...release,
    version: release.apkVersion || release.version,
    commit: release.apkCommit || release.commit,
    title: release.apkTitle || release.title,
    notes: release.apkNotes?.length ? release.apkNotes : release.notes,
    publishedAt: release.apkPublishedAt || release.publishedAt
  });
}

export function combineLatestReleases(releases: AppRelease[]): AppRelease | null {
  if (!releases.length) return null;
  const newestWeb = releases.slice().sort((left, right) => compareVersions(right.version, left.version))[0];
  const newestApk = releases
    .filter((item) => item.apkUrl || item.apkVersionCode)
    .sort((left, right) => (right.apkVersionCode ?? 0) - (left.apkVersionCode ?? 0))[0];
  if (!newestApk) return ensureAbsoluteApkUrl(newestWeb);
  return ensureAbsoluteApkUrl({
    ...newestWeb,
    apkUrl: newestApk.apkUrl,
    apkUrls: Array.from(new Set(releases.filter(item => item.apkVersionCode === newestApk.apkVersionCode
      && item.apkSha256 === newestApk.apkSha256).flatMap(item => [item.apkUrl, ...(item.apkUrls || [])])
      .filter((url): url is string => Boolean(url)))),
    apkVersionCode: newestApk.apkVersionCode,
    apkSha256: newestApk.apkSha256,
    apkVersion: newestApk.apkVersion,
    apkCommit: newestApk.apkCommit,
    apkTitle: newestApk.apkTitle,
    apkNotes: newestApk.apkNotes,
    apkPublishedAt: newestApk.apkPublishedAt
  });
}

export function skipReleaseVersion(version: string, apkVersionCode?: number) {
  localStorage.setItem(SKIPPED_RELEASE_KEY, version);
  if (typeof apkVersionCode === "number" && Number.isFinite(apkVersionCode)) {
    localStorage.setItem(SKIPPED_APK_CODE_KEY, String(apkVersionCode));
  }
}

/** Clear "skip this version" so a manual check can show the dialog again. */
export function clearSkippedRelease() {
  localStorage.removeItem(SKIPPED_RELEASE_KEY);
  localStorage.removeItem(SKIPPED_APK_CODE_KEY);
}

export function appUpdateEntryStatus(input: {
  updating: boolean;
  updateMessage: string;
  hasAvailableRelease: boolean;
  serviceWorkerNeedsRefresh: boolean;
}): string {
  if (input.updating) return input.updateMessage || "正在更新…";
  if (input.hasAvailableRelease) return "有新版本，点击更新";
  if (input.serviceWorkerNeedsRefresh) return "更新已下载，点击刷新";
  return input.updateMessage || "点击检查更新";
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.\-+_]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.\-+_]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Guarantee an absolute HTTPS APK URL when APK metadata is present. */
export function ensureAbsoluteApkUrl(release: AppRelease | null): AppRelease | null {
  if (!release) return null;
  const resolved = resolveReleaseApkUrl(release.apkUrl)
    || (release.apkVersionCode ? appMirrorApkUrl : undefined)
    || resolveReleaseApkUrl(appMirrorApkPath);
  if (resolved && resolved !== release.apkUrl) {
    return { ...release, apkUrl: resolved };
  }
  if (!release.apkUrl && resolved) {
    return { ...release, apkUrl: resolved };
  }
  return release;
}

export function apkDownloadUrlForRelease(release: AppRelease): string | undefined {
  const rawUrl = release.apkUrl || (release.apkVersionCode ? appMirrorApkUrl : undefined);
  const resolved = resolveReleaseApkUrl(rawUrl);
  if (!resolved) return undefined;
  try {
    const url = new URL(resolved);
    if (release.apkVersion || release.version) url.searchParams.set("v", release.apkVersion || release.version);
    if (release.apkVersionCode) url.searchParams.set("code", String(release.apkVersionCode));
    if (release.apkSha256) url.searchParams.set("sha", release.apkSha256.slice(0, 16));
    url.searchParams.set("t", String(Date.now()));
    return url.href;
  } catch {
    return resolved;
  }
}

export function apkDownloadUrlsForRelease(release: AppRelease): string[] {
  return Array.from(new Set([release.apkUrl, ...(release.apkUrls || [])].filter((url): url is string => {
    if (!url) return false;
    try { return new URL(url).protocol === "https:"; } catch { return false; }
  })));
}

async function fetchRelease(url: string, native: boolean): Promise<AppRelease> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        if (attempt === 0 && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
        throw new Error(`HTTP ${response.status}`);
      }
      let value: Partial<AppRelease>;
      try { value = await response.json() as Partial<AppRelease>; }
      catch { throw new Error("更新信息不是有效 JSON"); }
      if (!value || typeof value.version !== "string" || !value.version || !Array.isArray(value.notes)) {
        throw new Error("更新信息格式无效");
      }
      const apkVersionCode = Number(value.apkVersionCode);
      // Prefer explicit apkUrl; otherwise if apkVersionCode is published, default to the mirror APK path.
      const rawApkUrl = typeof value.apkUrl === "string" && value.apkUrl.trim()
        ? value.apkUrl.trim()
        : (Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? appMirrorApkPath : undefined);
      const apkUrl = resolveReleaseApkUrl(rawApkUrl)
        || (Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? appMirrorApkUrl : undefined);
      if (native && (!Number.isSafeInteger(apkVersionCode) || apkVersionCode <= 0
        || !/^[a-f0-9]{64}$/i.test(value.apkSha256 || "") || !apkUrl?.startsWith("https://"))) {
        throw new Error("安装包更新信息不完整");
      }
      return {
        version: String(value.version),
        commit: String(value.commit ?? ""),
        title: String(value.title ?? "版本更新"),
        notes: value.notes.map(String).filter(Boolean).slice(0, 12),
        publishedAt: String(value.publishedAt ?? ""),
        appUrl: String(value.appUrl ?? ""),
        apkUrl,
        apkUrls: Array.isArray(value.apkUrls) ? value.apkUrls.filter((item): item is string =>
          typeof item === "string" && item.startsWith("https://")) : undefined,
        apkVersionCode: Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? apkVersionCode : undefined,
        apkSha256: typeof value.apkSha256 === "string" && value.apkSha256.trim() ? value.apkSha256.trim().toLowerCase() : undefined,
        apkVersion: typeof value.apkVersion === "string" && value.apkVersion.trim() ? value.apkVersion.trim() : undefined,
        apkCommit: typeof value.apkCommit === "string" && value.apkCommit.trim() ? value.apkCommit.trim() : undefined,
        apkTitle: typeof value.apkTitle === "string" && value.apkTitle.trim() ? value.apkTitle.trim() : undefined,
        apkNotes: Array.isArray(value.apkNotes) ? value.apkNotes.map(String).filter(Boolean).slice(0, 12) : undefined,
        apkPublishedAt: typeof value.apkPublishedAt === "string" && value.apkPublishedAt.trim() ? value.apkPublishedAt.trim() : undefined
      };
    } catch (error) {
      lastError = controller.signal.aborted ? new Error("请求超时") : error;
      if (!(error instanceof TypeError) && !controller.signal.aborted) throw lastError;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError;
}
