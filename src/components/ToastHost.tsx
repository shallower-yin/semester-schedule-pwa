import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_TOAST_EVENT, type AppToast } from "../lib/toast";

export function ToastHost() {
  const [toasts, setToasts] = useState<AppToast[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<Omit<AppToast, "id">>).detail;
      if (!detail?.message) return;
      const toast: AppToast = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message: detail.message,
        tone: detail.tone ?? "info",
        durationMs: detail.durationMs ?? 3000
      };
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, toast.durationMs);
    }

    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, onToast);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <article key={toast.id} className={`app-toast ${toast.tone}`}>
          {toast.tone === "success" ? <CheckCircle2 size={18} /> : toast.tone === "error" ? <XCircle size={18} /> : <Info size={18} />}
          <span>{toast.message}</span>
          <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>
            <X size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}
