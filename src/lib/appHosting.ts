const DEFAULT_APP_URL = "https://shallower-yin.github.io/semester-schedule-pwa/";
const DEFAULT_ASSET_MIRROR_URL = "https://haifsnaupqhlvgfoyvlc.supabase.co/functions/v1/app-hosting/";

export const appInstallUrl = import.meta.env.VITE_APP_URL?.trim() || DEFAULT_APP_URL;
export const appAssetMirrorUrl = import.meta.env.VITE_APP_ASSET_MIRROR_URL?.trim() || DEFAULT_ASSET_MIRROR_URL;
export const appMirrorReleaseUrl = new URL("release.json", appAssetMirrorUrl).href;
export const appMirrorAssetManifestUrl = new URL("asset-manifest.json", appAssetMirrorUrl).href;

export function appMirrorAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), appAssetMirrorUrl).href;
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
