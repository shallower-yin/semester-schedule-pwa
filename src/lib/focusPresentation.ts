import { closeFocusSystemWindow } from "./focusSystemWindow";
import { FocusOverlay } from "./focusOverlayPlugin";
import { isNativeApp } from "./nativeApp";

// Cross-platform immersive fullscreen: browser uses Fullscreen API, APK uses native Android flags.
export async function enterImmersiveFullscreen(): Promise<void> {
  if (isNativeApp()) {
    await FocusOverlay.setImmersive({ enabled: "true" });
  } else if (document.documentElement.requestFullscreen) {
    try { await document.documentElement.requestFullscreen(); } catch { /* ignored */ }
  }
}

export async function exitImmersiveFullscreen(): Promise<void> {
  if (isNativeApp()) {
    await FocusOverlay.setImmersive({ enabled: "false" });
  } else if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* ignored */ }
  }
}

export async function lockOrientation(mode: "landscape" | "portrait" | "auto"): Promise<void> {
  if (isNativeApp()) await FocusOverlay.setOrientation({ mode });
}

/** Clear presentation state that must never survive an account switch. */
export async function resetAccountFocusPresentation(): Promise<void> {
  await Promise.allSettled([
    closeFocusSystemWindow(),
    exitImmersiveFullscreen(),
    lockOrientation("auto")
  ]);
}
