import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./nativeApp";

interface NativeFileExportPlugin {
  saveFile(options: {
    fileName: string;
    mimeType: string;
    base64: string;
  }): Promise<{ saved: boolean; uri?: string }>;
}

const NativeFileExport = registerPlugin<NativeFileExportPlugin>("NativeFileExport");

export interface ExportedFile {
  saved: boolean;
  uri?: string;
}

export async function exportBlob(blob: Blob, fileName: string): Promise<ExportedFile> {
  if (isNativeApp()) {
    const base64 = await blobToBase64(blob);
    return NativeFileExport.saveFile({
      fileName: sanitizeFileName(fileName),
      mimeType: blob.type || "application/octet-stream",
      base64
    });
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { saved: true };
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function exportText(content: string, fileName: string, mimeType = "text/plain;charset=utf-8"): Promise<ExportedFile> {
  return exportBlob(new Blob([content], { type: mimeType }), fileName);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 图片生成失败。")), "image/png", 0.95);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("文件编码失败。"));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "导出文件";
}
