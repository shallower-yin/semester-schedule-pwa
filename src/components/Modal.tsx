import { X } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

interface ModalProps extends PropsWithChildren {
  title: string;
  onClose: () => void;
  wide?: boolean;
  headerExtra?: ReactNode;
}

export function Modal({ title, onClose, wide = false, headerExtra, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div className="modal-title-row">
            <h2>{title}</h2>
            {headerExtra && <div className="modal-header-extra">{headerExtra}</div>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
