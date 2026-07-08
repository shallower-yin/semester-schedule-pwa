import { Check, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DEFAULT_THEME_SKIN, saveThemeSkin, THEME_SKINS, type ThemeSkinId } from "../lib/themeSkins";
import { Modal } from "./Modal";

interface ThemeSkinDialogProps {
  value: ThemeSkinId;
  onChange: (skin: ThemeSkinId) => void;
  onClose: () => void;
}

export function ThemeSkinDialog({ value, onChange, onClose }: ThemeSkinDialogProps) {
  const [draft, setDraft] = useState<ThemeSkinId>(value);

  function save() {
    const next = saveThemeSkin(draft);
    onChange(next);
    onClose();
  }

  function reset() {
    setDraft(DEFAULT_THEME_SKIN);
  }

  return (
    <Modal title="界面皮肤" onClose={onClose} wide>
      <div className="theme-skin-dialog">
        <div className="theme-skin-grid">
          {THEME_SKINS.map((skin) => (
            <button
              key={skin.id}
              type="button"
              className={`theme-skin-card theme-skin-preview-${skin.id} ${draft === skin.id ? "active" : ""}`}
              onClick={() => setDraft(skin.id)}
            >
              <span className="theme-skin-preview">
                <i />
                <b />
                <em />
              </span>
              <span className="theme-skin-meta">
                <strong>{skin.name}</strong>
                <small>{skin.description}</small>
              </span>
              <span className="theme-skin-swatches">
                {skin.colors.map((color) => <i key={color} style={{ background: color }} />)}
              </span>
              {draft === skin.id && <span className="theme-skin-check"><Check size={16} /></span>}
            </button>
          ))}
        </div>
        <div className="form-actions split">
          <button type="button" className="button secondary" onClick={reset}><RotateCcw size={16} />恢复默认</button>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button type="button" className="button primary" onClick={save}>保存皮肤</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
