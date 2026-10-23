/**
 * Clear service workers and Cache Storage, then hard-navigate.
 * Used after offline updates and boot-time white-screen recovery so mixed
 * workbox/runtime caches cannot leave the app stuck on a blank root.
 */
export async function clearAppCachesAndReload(reason = "reload"): Promise<void> {
  const appScope = new URL(import.meta.env.BASE_URL, window.location.href).href;
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) => registration.scope === appScope)
        .map((registration) => registration.unregister()));
    }
  } catch {
    // Best-effort cleanup.
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(async (key) => {
        if (key.startsWith("workbox-") && key.endsWith(`-${appScope}`)) {
          await caches.delete(key);
        } else if (key === "semester-schedule-offline-updates" || key.startsWith("semester-schedule-offline-updates-v2-")) {
          // Legacy caches (and relative-base deployments) can be shared by
          // several scopes. Remove only positively identified app assets.
          const cache = await caches.open(key);
          const scope = new URL(appScope);
          const requests = await cache.keys();
          await Promise.all(requests.filter((request) => {
            const url = new URL(request.url);
            if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
            const path = url.pathname.slice(scope.pathname.length);
            return /^(?:assets\/[^/]+\.(?:css|js|mjs|png|svg|webp|woff2?)|focus\/focus-bg-[1-4]\.webp|favicon\.svg|app-icon(?:-192|-512)?\.(?:png|svg)|manifest\.webmanifest|release\.json)$/.test(path);
          }).map((request) => cache.delete(request)));
        }
      }));
    }
  } catch {
    // Best-effort cleanup.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(reason, String(Date.now()));
  url.searchParams.delete("recovered");
  window.location.replace(url.pathname + url.search + url.hash);
}
