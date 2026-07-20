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
}

export const FocusOverlay = registerPlugin<FocusOverlayPlugin>("FocusOverlay");
