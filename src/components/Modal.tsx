import { X } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { useHistoryLayer } from "../lib/useHistoryLayer";

interface ModalProps extends PropsWithChildren {
  title: string;
  onClose: () => void;
  wide?: boolean;
  headerExtra?: ReactNode;
  className?: string;
}

export function Modal({ title, onClose, wide = false, headerExtra, className = "", children }: ModalProps) {
  const requestClose = useHistoryLayer(true, onClose, "modal");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div className="modal-title-row">
            <h2>{title}</h2>
            {headerExtra && <div className="modal-header-extra">{headerExtra}</div>}
          </div>
          <button className="icon-button" onClick={requestClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
