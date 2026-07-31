import { appMirrorApkPath, appMirrorApkUrl, appMirrorReleaseUrl, resolveReleaseApkUrl } from "./appHosting";

export interface AppRelease {
  version: string;
  commit: string;
  title: string;
  notes: string[];
  publishedAt: string;
  appUrl: string;
  /** HTTPS URL of a signed APK for in-app sideload updates (Android only). */
  apkUrl?: string;
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

export async function fetchLatestRelease(): Promise<AppRelease | null> {
  const candidates = Array.from(new Set([
    new URL("release.json", document.baseURI).href,
    appMirrorReleaseUrl
  ]));
  const results = await Promise.allSettled(candidates.map(fetchRelease));
  const releases = results
    .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (!releases.length) return null;

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
  return "点击检查更新";
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

async function fetchRelease(url: string): Promise<AppRelease | null> {
  const controller = new AbortController();
  // Mobile networks to the asset mirror often need more than a few seconds.
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const value = await response.json() as Partial<AppRelease>;
    if (!value.version || !Array.isArray(value.notes)) return null;
    const apkVersionCode = Number(value.apkVersionCode);
    // Prefer explicit apkUrl; otherwise if apkVersionCode is published, default to the mirror APK path.
    const rawApkUrl = typeof value.apkUrl === "string" && value.apkUrl.trim()
      ? value.apkUrl.trim()
      : (Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? appMirrorApkPath : undefined);
    const apkUrl = resolveReleaseApkUrl(rawApkUrl)
      || (Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? appMirrorApkUrl : undefined);
    return {
      version: String(value.version),
      commit: String(value.commit ?? ""),
      title: String(value.title ?? "版本更新"),
      notes: value.notes.map(String).filter(Boolean).slice(0, 12),
      publishedAt: String(value.publishedAt ?? ""),
      appUrl: String(value.appUrl ?? ""),
      apkUrl,
      apkVersionCode: Number.isFinite(apkVersionCode) && apkVersionCode > 0 ? apkVersionCode : undefined,
      apkSha256: typeof value.apkSha256 === "string" && value.apkSha256.trim() ? value.apkSha256.trim().toLowerCase() : undefined,
      apkVersion: typeof value.apkVersion === "string" && value.apkVersion.trim() ? value.apkVersion.trim() : undefined,
      apkCommit: typeof value.apkCommit === "string" && value.apkCommit.trim() ? value.apkCommit.trim() : undefined,
      apkTitle: typeof value.apkTitle === "string" && value.apkTitle.trim() ? value.apkTitle.trim() : undefined,
      apkNotes: Array.isArray(value.apkNotes) ? value.apkNotes.map(String).filter(Boolean).slice(0, 12) : undefined,
      apkPublishedAt: typeof value.apkPublishedAt === "string" && value.apkPublishedAt.trim() ? value.apkPublishedAt.trim() : undefined
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
