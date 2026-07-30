import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const dialogRef = useRef<HTMLElement>(null);
  const modalId = useRef(`modal-ui-${crypto.randomUUID()}`);
  const titleId = useId();

  useEffect(() => {
    const id = modalId.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    registerModal(id);
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(id)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      trapTabKey(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unregisterModal(id);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [requestClose]);

  return createPortal((
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section
        ref={dialogRef}
        className={`modal ${wide ? "modal-wide" : ""} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-title-row">
            <h2 id={titleId}>{title}</h2>
            {headerExtra && <div className="modal-header-extra">{headerExtra}</div>}
          </div>
          <button className="icon-button" onClick={requestClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  ), document.body);
}

const modalStack: string[] = [];
let originalBodyOverflow = "";

function registerModal(id: string): void {
  modalStack.push(id);
  if (modalStack.length !== 1) return;
  originalBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function unregisterModal(id: string): void {
  const index = modalStack.lastIndexOf(id);
  if (index >= 0) modalStack.splice(index, 1);
  if (modalStack.length) return;
  document.body.style.overflow = originalBodyOverflow;
}

function isTopModal(id: string): boolean {
  return modalStack.at(-1) === id;
}

function trapTabKey(event: KeyboardEvent | ReactKeyboardEvent, dialog: HTMLElement): void {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}
