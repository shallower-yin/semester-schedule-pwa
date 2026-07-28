import { isNativeApp } from "./nativeApp";
import { FocusOverlay } from "./focusOverlayPlugin";

let browserWakeLock: WakeLockSentinel | null = null;

export function focusScreenWakeLockSupported(): boolean {
  return isNativeApp() || "wakeLock" in navigator;
}

export async function enableFocusScreenWakeLock(): Promise<boolean> {
  if (isNativeApp()) {
    await FocusOverlay.setKeepAwake({ enabled: "true" });
    return true;
  }
  if (!("wakeLock" in navigator)) return false;
  if (browserWakeLock && !browserWakeLock.released) return true;
  browserWakeLock = await navigator.wakeLock.request("screen");
  browserWakeLock.addEventListener("release", () => {
    browserWakeLock = null;
  }, { once: true });
  return true;
}

export async function disableFocusScreenWakeLock(): Promise<void> {
  if (isNativeApp()) {
    await FocusOverlay.setKeepAwake({ enabled: "false" });
    return;
  }
  const current = browserWakeLock;
  browserWakeLock = null;
  if (current && !current.released) await current.release();
}
