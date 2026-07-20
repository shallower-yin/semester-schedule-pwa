import { registerPlugin } from "@capacitor/core";

export interface FocusOverlayPayload {
  startedAt: number;
  pausedSeconds: number;
  pauseStartedAt: number;
  plannedSeconds: number;
  label: string;
  title: string;
}

export interface FocusOverlayPermission {
  granted: boolean;
}

export interface FocusOverlayPlugin {
  hasPermission(): Promise<FocusOverlayPermission>;
  requestPermission(): Promise<FocusOverlayPermission>;
  show(options: FocusOverlayPayload): Promise<void>;
  update(options: FocusOverlayPayload): Promise<void>;
  hide(): Promise<void>;
  /** Enter or exit Android immersive mode (hides status bar + nav bar). */
  setImmersive(options: { enabled: string }): Promise<void>;
  /** Lock screen orientation: "landscape" | "portrait" | "auto". */
  setOrientation(options: { mode: string }): Promise<void>;
}

export const FocusOverlay = registerPlugin<FocusOverlayPlugin>("FocusOverlay");
