import { GripVertical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DEFAULT_MOBILE_NAV, saveMobileNavSettings } from "../lib/mobileNavSettings";
import type { PageId } from "../types";
import { Modal } from "./Modal";

interface MobileNavOption {
  id: PageId;
  label: string;
}

interface MobileNavSettingsDialogProps {
  options: MobileNavOption[];
  value: PageId[];
  onChange: (items: PageId[]) => void;
  onClose: () => void;
}

export function MobileNavSettingsDialog({ options, value, onChange, onClose }: MobileNavSettingsDialogProps) {
  const [draft, setDraft] = useState<PageId[]>(value);

  function toggle(id: PageId) {
    setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function move(id: PageId, direction: number) {
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
    const normalized = saveMobileNavSettings(draft);
    onChange(normalized);
    onClose();
  }

  return (
    <Modal title="底部按钮设置" onClose={onClose}>
      <div className="mobile-nav-settings">
        <p>勾选要放在手机底部的入口，并调整显示顺序。未勾选的入口仍可从左上角菜单进入。</p>
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
          <button type="button" className="button secondary" onClick={() => setDraft(DEFAULT_MOBILE_NAV)}><RotateCcw size={16} />恢复默认</button>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button type="button" className="button primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
