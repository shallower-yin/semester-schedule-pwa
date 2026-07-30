import { Download, RefreshCw, Rocket } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AppRelease } from "../lib/appRelease";

interface UpdateNotesDialogProps {
  currentVersion: string;
  release: AppRelease;
  updating: boolean;
  updateMessage: string;
  onSkip: () => void;
  onBackgroundUpdate: () => void;
  onUpdate: () => void;
}

export function UpdateNotesDialog({
  currentVersion,
  release,
  updating,
  updateMessage,
  onSkip,
  onBackgroundUpdate,
  onUpdate
}: UpdateNotesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
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
    }
  }

  return createPortal((
    <div className="modal-backdrop update-notes-backdrop">
      <section
        ref={dialogRef}
        className="update-notes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header>
          <span><Rocket size={22} /></span>
          <div><h2 id={titleId}>发现新版本</h2><p>{currentVersion} → {release.version}</p></div>
        </header>
        <div className="update-notes-body">
          <h3>{release.title}</h3>
          <ul>{release.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          {updating && <p className="update-notes-progress"><RefreshCw size={15} />{updateMessage || "正在安装新版本…"}</p>}
        </div>
        <footer>
          <button type="button" className="button secondary" disabled={updating} onClick={onSkip}>跳过此版本</button>
          <button type="button" className="button secondary" disabled={updating} onClick={onBackgroundUpdate}><Download size={16} />后台更新</button>
          <button type="button" className="button primary" disabled={updating} onClick={onUpdate}><RefreshCw size={16} />{updating ? "更新中…" : "立即更新"}</button>
        </footer>
      </section>
    </div>
  ), document.body);
}
