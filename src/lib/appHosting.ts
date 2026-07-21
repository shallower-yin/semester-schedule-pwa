const DEFAULT_APP_URL = "https://shallower-yin.github.io/semester-schedule-pwa/";
const DEFAULT_ASSET_MIRROR_URL = "https://haifsnaupqhlvgfoyvlc.supabase.co/functions/v1/app-hosting/";

export const appInstallUrl = import.meta.env.VITE_APP_URL?.trim() || DEFAULT_APP_URL;
export const appAssetMirrorUrl = import.meta.env.VITE_APP_ASSET_MIRROR_URL?.trim() || DEFAULT_ASSET_MIRROR_URL;
export const appMirrorReleaseUrl = new URL("release.json", appAssetMirrorUrl).href;
export const appMirrorAssetManifestUrl = new URL("asset-manifest.json", appAssetMirrorUrl).href;
/** Conventional path on the same app-hosting mirror used by the web offline updater. */
export const appMirrorApkPath = "android/semester-schedule.apk";
export const appMirrorApkUrl = new URL(appMirrorApkPath, appAssetMirrorUrl).href;

export function appMirrorAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), appAssetMirrorUrl).href;
}

/** Resolve release.apkUrl: absolute https stays; relative paths resolve against the asset mirror. */
export function resolveReleaseApkUrl(apkUrl?: string | null): string | undefined {
  const value = apkUrl?.trim();
  if (!value) return undefined;
  try {
    if (/^https?:\/\//i.test(value)) return value;
    return appMirrorAssetUrl(value);
  } catch {
    return undefined;
  }
}

export function isCurrentAppUrl(url: string): boolean {
  try {
    const target = new URL(url, window.location.href);
    return target.origin === window.location.origin && normalizeAppPath(target.pathname) === normalizeAppPath(window.location.pathname);
  } catch {
    return false;
  }
}

function normalizeAppPath(pathname: string): string {
  return pathname.replace(/\/index\.html$/i, "/").replace(/\/+$/, "/");
}
