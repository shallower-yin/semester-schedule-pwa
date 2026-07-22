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

  // Prefer the mirror (or any source) that carries APK metadata, highest versionCode first.
  const withApk = releases
    .filter((item) => item.apkUrl || item.apkVersionCode)
    .sort((left, right) => (right.apkVersionCode ?? 0) - (left.apkVersionCode ?? 0));
  if (withApk.length) {
    return ensureAbsoluteApkUrl(withApk[0]);
  }
  return ensureAbsoluteApkUrl(
    releases.sort((left, right) => compareVersions(right.version, left.version))[0] ?? null
  );
}

export function shouldShowRelease(currentVersion: string, release: AppRelease | null): release is AppRelease {
  if (!release || compareVersions(release.version, currentVersion) <= 0) return false;
  return localStorage.getItem(SKIPPED_RELEASE_KEY) !== release.version;
}

/**
 * APK should show the same release-notes dialog as the web build when
 * release.json version advances, and also when a newer APK binary (versionCode) is published.
 */
export function shouldShowNativeRelease(
  installed: { versionCode: number; versionName: string },
  release: AppRelease | null,
  packagedWebVersion: string = installed.versionName
): release is AppRelease {
  if (!release) return false;
  // Same human version gate as PWA (avoid type-predicate narrowing that collapses release to never).
  const webVersion = packagedWebVersion || installed.versionName;
  if (
    compareVersions(release.version, webVersion) > 0
    && localStorage.getItem(SKIPPED_RELEASE_KEY) !== release.version
  ) {
    return true;
  }
  const apkCode = release.apkVersionCode;
  if (typeof apkCode === "number" && Number.isFinite(apkCode)) {
    if (localStorage.getItem(SKIPPED_APK_CODE_KEY) === String(apkCode)) return false;
    return apkCode > installed.versionCode;
  }
  return false;
}

export function skipReleaseVersion(version: string, apkVersionCode?: number) {
  localStorage.setItem(SKIPPED_RELEASE_KEY, version);
  if (typeof apkVersionCode === "number" && Number.isFinite(apkVersionCode)) {
    localStorage.setItem(SKIPPED_APK_CODE_KEY, String(apkVersionCode));
  }
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
      apkSha256: typeof value.apkSha256 === "string" && value.apkSha256.trim() ? value.apkSha256.trim().toLowerCase() : undefined
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
