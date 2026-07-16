import { Camera, FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

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
  const [mobileMode, setMobileMode] = useState(isMobileAttachmentDevice);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse)");
    const update = () => setMobileMode(media.matches || navigator.maxTouchPoints > 0);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      const margin = 8;
      const gap = 7;
      const availableAbove = trigger.top - margin;
      const availableBelow = window.innerHeight - trigger.bottom - margin;
      const placeBelow = availableBelow >= menu.height || availableBelow > availableAbove;
      const top = placeBelow
        ? Math.min(window.innerHeight - menu.height - margin, trigger.bottom + gap)
        : Math.max(margin, trigger.top - menu.height - gap);
      const centeredLeft = trigger.left + trigger.width / 2 - menu.width / 2;
      const left = Math.min(window.innerWidth - menu.width - margin, Math.max(margin, centeredLeft));
      setMenuStyle({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function choose(ref: RefObject<HTMLInputElement | null>) {
    setOpen(false);
    ref.current?.click();
  }

  function handleFiles(files: FileList | null, input: HTMLInputElement) {
    void onFiles(files);
    input.value = "";
  }

  return (
    <div ref={pickerRef} className={`attachment-source-picker ${className}`.trim()} data-mode={mobileMode ? "mobile" : "desktop"}>
      <button
        ref={triggerRef}
        type="button"
        className="button secondary attachment-source-trigger"
        aria-label={ariaLabel}
        aria-expanded={mobileMode ? open : undefined}
        disabled={disabled}
        onClick={() => mobileMode ? setOpen((current) => !current) : desktopRef.current?.click()}
      >
        <Paperclip size={16} /><span>{label}</span>
      </button>
      {mobileMode && open && createPortal((
        <div ref={menuRef} className="attachment-source-menu" style={menuStyle} role="menu" aria-label="附件来源">
          <button type="button" role="menuitem" onClick={() => choose(galleryRef)}><ImageIcon size={17} /><span><strong>相册</strong><small>选择已有图片</small></span></button>
          <button type="button" role="menuitem" onClick={() => choose(cameraRef)}><Camera size={17} /><span><strong>拍照</strong><small>打开相机拍摄</small></span></button>
          <button type="button" role="menuitem" onClick={() => choose(documentRef)}><FileText size={17} /><span><strong>文件</strong><small>从文件管理器选择</small></span></button>
        </div>
      ), document.body)}
      <input
        ref={desktopRef}
        className="visually-hidden"
        type="file"
        accept={`${imageAccept},${documentAccept}`}
        multiple={multiple}
        aria-label="从电脑选择文件"
        onChange={(event) => handleFiles(event.target.files, event.currentTarget)}
      />
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

function isMobileAttachmentDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}
