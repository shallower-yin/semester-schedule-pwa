import { GripVertical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DEFAULT_HEADER_TOOLS, saveHeaderToolSettings, type HeaderToolId } from "../lib/headerToolSettings";
import { Modal } from "./Modal";

interface HeaderToolOption {
  id: HeaderToolId;
  label: string;
}

interface HeaderToolSettingsDialogProps {
  options: HeaderToolOption[];
  value: HeaderToolId[];
  onChange: (items: HeaderToolId[]) => void;
  onClose: () => void;
}

export function HeaderToolSettingsDialog({ options, value, onChange, onClose }: HeaderToolSettingsDialogProps) {
  const [draft, setDraft] = useState<HeaderToolId[]>(value);

  function toggle(id: HeaderToolId) {
    setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function move(id: HeaderToolId, direction: number) {
    setDraft((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function save() {
    const normalized = saveHeaderToolSettings(draft);
    onChange(normalized);
    onClose();
  }

  return (
    <Modal title="顶部按钮设置" onClose={onClose}>
      <div className="mobile-nav-settings">
        <p>勾选要放在顶部的工具，并调整显示顺序。未勾选的工具仍可从设置页或其他入口使用。</p>
        <div className="mobile-nav-option-list">
          {options.map((option) => {
            const selected = draft.includes(option.id);
            const index = draft.indexOf(option.id);
            return (
              <article key={option.id} className={selected ? "selected" : ""}>
                <label>
                  <input type="checkbox" checked={selected} onChange={() => toggle(option.id)} />
                  <span>{option.label}</span>
                </label>
                <div className="inline-actions">
                  <button type="button" className="icon-button" disabled={!selected || index <= 0} onClick={() => move(option.id, -1)} aria-label={`${option.label}前移`}>
                    <GripVertical size={16} />
                  </button>
                  <button type="button" className="button secondary compact" disabled={!selected || index >= draft.length - 1} onClick={() => move(option.id, 1)}>
                    后移
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="form-actions split">
          <button type="button" className="button secondary" onClick={() => setDraft(DEFAULT_HEADER_TOOLS)}><RotateCcw size={16} />恢复默认</button>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button type="button" className="button primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
