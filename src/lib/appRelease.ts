import { appMirrorReleaseUrl } from "./appHosting";

export interface AppRelease {
  version: string;
  commit: string;
  title: string;
  notes: string[];
  publishedAt: string;
  appUrl: string;
}

const SKIPPED_RELEASE_KEY = "semester-schedule-skipped-release";

export async function fetchLatestRelease(): Promise<AppRelease | null> {
  const candidates = Array.from(new Set([
    new URL("release.json", document.baseURI).href,
    appMirrorReleaseUrl
  ]));
  const results = await Promise.allSettled(candidates.map(fetchRelease));
  return results
    .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
    .sort((left, right) => compareVersions(right.version, left.version))[0] ?? null;
}

export function shouldShowRelease(currentVersion: string, release: AppRelease | null): release is AppRelease {
  if (!release || compareVersions(release.version, currentVersion) <= 0) return false;
  return localStorage.getItem(SKIPPED_RELEASE_KEY) !== release.version;
}

export function skipReleaseVersion(version: string) {
  localStorage.setItem(SKIPPED_RELEASE_KEY, version);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function fetchRelease(url: string): Promise<AppRelease | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const value = await response.json() as Partial<AppRelease>;
    if (!value.version || !Array.isArray(value.notes)) return null;
    return {
      version: String(value.version),
      commit: String(value.commit ?? ""),
      title: String(value.title ?? "版本更新"),
      notes: value.notes.map(String).filter(Boolean).slice(0, 12),
      publishedAt: String(value.publishedAt ?? ""),
      appUrl: String(value.appUrl ?? "")
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
