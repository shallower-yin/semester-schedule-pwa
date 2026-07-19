import type { MemoImage } from "../types";
import { supabase } from "./supabase";

export const MEMO_IMAGE_LIMIT = 6;
export const MEMO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const BUCKET = "memo-images";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function uploadMemoImage(input: { userId: string; memoId: string; file: File }): Promise<MemoImage> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法插入图片。");
  validateMemoImage(input.file);
  const mimeType = memoImageType(input.file);
  const id = crypto.randomUUID();
  const path = `${input.userId}/${input.memoId}/${id}${safeExtension(input.file.name, mimeType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: mimeType,
    cacheControl: "3600",
    upsert: false
  });
  if (error) throw new Error(error.message || `上传 ${input.file.name} 失败。`);
  return { id, name: input.file.name, path, mime_type: mimeType, size: input.file.size };
}

export async function getMemoImageUrls(images: MemoImage[]): Promise<Record<string, string>> {
  if (!supabase || !images.length) return {};
  const client = supabase;
  const entries = await Promise.all(images.map(async (image) => {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(image.path, 3600);
    if (error || !data?.signedUrl) return [image.path, ""] as const;
    return [image.path, data.signedUrl] as const;
  }));
  return Object.fromEntries(entries.filter((entry) => entry[1]));
}

export async function removeMemoImages(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return;
  if (!supabase) throw new Error("云端服务未配置，暂时无法删除图片。");
  const { error } = await supabase.storage.from(BUCKET).remove(uniquePaths);
  if (error) throw new Error(error.message || "删除备忘录图片失败。");
}

export function normalizeMemoImages(value: unknown): MemoImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path) return [];
    return [{
      id: typeof row.id === "string" && row.id ? row.id : path,
      name: typeof row.name === "string" && row.name ? row.name : "备忘录图片",
      path,
      mime_type: typeof row.mime_type === "string" ? row.mime_type : "image/jpeg",
      size: Math.max(0, Number(row.size ?? 0))
    }];
  }).slice(0, MEMO_IMAGE_LIMIT);
}

export function validateMemoImage(file: File): void {
  if (!ALLOWED_TYPES.has(memoImageType(file))) throw new Error(`${file.name} 的格式不支持，请选择 JPG、PNG、WebP 或 GIF 图片。`);
  if (file.size > MEMO_IMAGE_MAX_BYTES) throw new Error(`${file.name} 超过 8 MB。`);
}

function memoImageType(file: File): string {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]{1,8}$/)?.[0];
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return file.type;
}

function safeExtension(name: string, mimeType: string): string {
  const extension = name.toLowerCase().match(/\.[a-z0-9]{1,8}$/)?.[0];
  if (extension && [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) return extension;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}
