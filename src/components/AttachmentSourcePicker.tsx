import { Camera, FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

interface AttachmentSourcePickerProps {
  disabled?: boolean;
  imageAccept: string;
  documentAccept: string;
  multiple?: boolean;
  label?: string;
  ariaLabel?: string;
  className?: string;
  onFiles: (files: FileList | null) => void | Promise<void>;
}

export function AttachmentSourcePicker({
  disabled = false,
  imageAccept,
  documentAccept,
  multiple = true,
  label = "附件",
  ariaLabel = "选择附件来源",
  className = "",
  onFiles
}: AttachmentSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);

  function choose(ref: RefObject<HTMLInputElement | null>) {
    setOpen(false);
    ref.current?.click();
  }

  function handleFiles(files: FileList | null, input: HTMLInputElement) {
    void onFiles(files);
    input.value = "";
  }

  return (
    <div className={`attachment-source-picker ${className}`.trim()}>
      <button
        type="button"
        className="button secondary attachment-source-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Paperclip size={16} /><span>{label}</span>
      </button>
      {open && (
        <div className="attachment-source-menu" role="menu" aria-label="附件来源">
          <button type="button" role="menuitem" onClick={() => choose(galleryRef)}><ImageIcon size={17} /><span><strong>相册</strong><small>选择已有图片</small></span></button>
          <button type="button" role="menuitem" onClick={() => choose(cameraRef)}><Camera size={17} /><span><strong>拍照</strong><small>打开相机拍摄</small></span></button>
          <button type="button" role="menuitem" onClick={() => choose(documentRef)}><FileText size={17} /><span><strong>文件</strong><small>从文件管理器选择</small></span></button>
        </div>
      )}
      <input
        ref={galleryRef}
        className="visually-hidden"
        type="file"
        accept={imageAccept}
        multiple={multiple}
        aria-label="从相册选择"
        onChange={(event) => handleFiles(event.target.files, event.currentTarget)}
      />
      <input
        ref={cameraRef}
        className="visually-hidden"
        type="file"
        accept={imageAccept}
        capture="environment"
        aria-label="拍照上传"
        onChange={(event) => handleFiles(event.target.files, event.currentTarget)}
      />
      <input
        ref={documentRef}
        className="visually-hidden"
        type="file"
        accept={documentAccept}
        multiple={multiple}
        aria-label="从文件管理器选择"
        onChange={(event) => handleFiles(event.target.files, event.currentTarget)}
      />
    </div>
  );
}
