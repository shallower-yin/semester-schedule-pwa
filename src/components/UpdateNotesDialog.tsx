import { Download, RefreshCw, Rocket } from "lucide-react";
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
  return (
    <div className="modal-backdrop update-notes-backdrop">
      <section className="update-notes-dialog" role="dialog" aria-modal="true" aria-label="发现新版本">
        <header>
          <span><Rocket size={22} /></span>
          <div><h2>发现新版本</h2><p>{currentVersion} → {release.version}</p></div>
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
  );
}
