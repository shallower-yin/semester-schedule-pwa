export type ToastTone = "success" | "error" | "info";

export interface AppToast {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

export const APP_TOAST_EVENT = "semester-schedule-toast";

export function showToast(message: string, tone: ToastTone = "info", durationMs = 3000): void {
  const text = message.trim();
  if (!text) return;
  window.dispatchEvent(new CustomEvent<Omit<AppToast, "id">>(APP_TOAST_EVENT, {
    detail: {
      message: text,
      tone,
      durationMs
    }
  }));
}
