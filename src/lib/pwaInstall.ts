export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Window {
    __pwaInstallPrompt: BeforeInstallPromptEvent | null;
  }
}

export const PWA_INSTALL_AVAILABLE_EVENT = "pwa-install-available";

export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
  return window.__pwaInstallPrompt ?? null;
}

export function clearCapturedInstallPrompt(): void {
  window.__pwaInstallPrompt = null;
}
