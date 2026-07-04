import { X } from "lucide-react";
import type { PropsWithChildren } from "react";

interface ModalProps extends PropsWithChildren {
  title: string;
  onClose: () => void;
  wide?: boolean;
}

export function Modal({ title, onClose, wide = false, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
