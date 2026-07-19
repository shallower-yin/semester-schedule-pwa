import { Check, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import {
  APP_FONT_SIZES,
  DEFAULT_APP_FONT_SIZE,
  saveAppFontSize,
  type AppFontSizeId
} from "../lib/fontSizes";
import { Modal } from "./Modal";

interface FontSizeDialogProps {
  value: AppFontSizeId;
  onChange: (fontSize: AppFontSizeId) => void;
  onClose: () => void;
}

export function FontSizeDialog({ value, onChange, onClose }: FontSizeDialogProps) {
  const originalValue = useRef(value);
  const [draft, setDraft] = useState<AppFontSizeId>(value);

  function preview(next: AppFontSizeId) {
    setDraft(next);
    onChange(next);
  }

  function cancel() {
    onChange(originalValue.current);
    onClose();
  }

  function save() {
    const next = saveAppFontSize(draft);
    onChange(next);
    onClose();
  }

  return (
    <Modal title="字体大小" onClose={cancel} wide>
      <div className="font-size-dialog">
        <p className="font-size-help">选择后会立即预览，只调整文字大小，不缩小按钮点击区域。设置会保存在当前设备。</p>
        <div className="font-size-options" role="radiogroup" aria-label="字体大小">
          {APP_FONT_SIZES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`font-size-option ${draft === option.id ? "active" : ""}`}
              role="radio"
              aria-checked={draft === option.id}
              onClick={() => preview(option.id)}
            >
              <span className="font-size-sample" style={{ fontSize: `${Math.round(16 * option.scale)}px` }}>日程文字</span>
              <span className="font-size-option-copy">
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
              {draft === option.id && <span className="font-size-check"><Check size={16} /></span>}
            </button>
          ))}
        </div>
        <div className="form-actions split">
          <button type="button" className="button secondary" onClick={() => preview(DEFAULT_APP_FONT_SIZE)}><RotateCcw size={16} />恢复标准</button>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={cancel}>取消</button>
            <button type="button" className="button primary" onClick={save}>保存字号</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
