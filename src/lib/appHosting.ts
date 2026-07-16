const DEFAULT_MIRROR_URL = "https://raw.githack.com/shallower-yin/semester-schedule-pwa/app-mirror/index.html";

export const appMirrorUrl = import.meta.env.VITE_APP_MIRROR_URL?.trim() || DEFAULT_MIRROR_URL;
export const appMirrorReleaseUrl = new URL("release.json", appMirrorUrl).href;

export function isCurrentAppUrl(url: string): boolean {
  try {
    const target = new URL(url, window.location.href);
    return target.origin === window.location.origin && target.pathname === window.location.pathname;
  } catch {
    return false;
  }
}
