/**
 * Clear service workers and Cache Storage, then hard-navigate.
 * Used after offline updates and boot-time white-screen recovery so mixed
 * workbox/runtime caches cannot leave the app stuck on a blank root.
 */
export async function clearAppCachesAndReload(reason = "reload"): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Best-effort cleanup.
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Best-effort cleanup.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(reason, String(Date.now()));
  url.searchParams.delete("recovered");
  window.location.replace(url.pathname + url.search + url.hash);
}
