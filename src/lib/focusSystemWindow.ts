import { focusModeLabel, type ActiveFocusState } from "./focus";
import {
  closeFocusPictureInPicture,
  focusPictureInPictureSupported,
  openFocusPictureInPicture,
  updateFocusPictureInPicture
} from "./focusPictureInPicture";
import { FocusOverlay, type FocusOverlayPayload } from "./focusOverlayPlugin";
import { isNativeApp } from "./nativeApp";

// The browser shows the countdown via picture-in-picture; the Android WebView cannot, so the APK
// draws a native system overlay instead. Both paths are driven by the same ActiveFocusState so the
// focus page and headless timer do not need to know which platform they are on.

let lastNativePayload = "";
/** True after a successful native show until hide. Prevents idle update IPC when the card is closed. */
let nativeWindowOpen = false;

function overlayPayload(active: ActiveFocusState): FocusOverlayPayload {
  return {
    startedAt: new Date(active.started_at).getTime(),
    pausedSeconds: active.paused_seconds,
    pauseStartedAt: active.pause_started_at ? new Date(active.pause_started_at).getTime() : -1,
    plannedSeconds: active.planned_seconds ?? -1,
    label: active.pause_started_at ? "已暂停" : focusModeLabel(active.mode),
    title: active.task_title
  };
}

export function focusSystemWindowSupported(): boolean {
  return isNativeApp() ? true : focusPictureInPictureSupported();
}

/**
 * Opens the countdown window. On the APK this requests the "display over other apps" permission when
 * the user triggers it explicitly (interactive); background auto-opens stay silent if not granted.
 */
export async function openFocusSystemWindow(
  active: ActiveFocusState,
  now = new Date(),
  interactive = false
): Promise<void> {
  if (isNativeApp()) {
    const permission = await FocusOverlay.hasPermission();
    if (!permission.granted) {
      if (!interactive) return;
      const requested = await FocusOverlay.requestPermission();
      if (!requested.granted) {
        throw new Error("需要“显示在其他应用上层”权限才能开启悬浮窗，请在系统设置中允许后重试。");
      }
    }
    const payload = overlayPayload(active);
    lastNativePayload = JSON.stringify(payload);
    await FocusOverlay.show(payload);
    nativeWindowOpen = true;
    return;
  }
  await openFocusPictureInPicture(active, now);
}

export function updateFocusSystemWindow(active: ActiveFocusState | null, now = new Date()): void {
  if (isNativeApp()) {
    if (!active || !nativeWindowOpen) return;
    const payload = overlayPayload(active);
    const serialized = JSON.stringify(payload);
    // The native overlay ticks itself, so only push when the anchors actually change
    // (pause/resume, title, planned duration). Same anchors must not re-open or reset time.
    if (serialized === lastNativePayload) return;
    lastNativePayload = serialized;
    void FocusOverlay.update(payload);
    return;
  }
  updateFocusPictureInPicture(active, now);
}

export async function closeFocusSystemWindow(): Promise<void> {
  if (isNativeApp()) {
    lastNativePayload = "";
    nativeWindowOpen = false;
    await FocusOverlay.hide();
    return;
  }
  await closeFocusPictureInPicture();
}
