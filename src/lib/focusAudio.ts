import { supabase } from "./supabase";

export type FocusAudioKind = "white_noise" | "music";

export interface FocusAudioTrack {
  id: string;
  title: string;
  kind: FocusAudioKind;
  storage_path: string;
  mime_type: string;
  file_size: number;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const BUCKET = "focus-audio";
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/x-m4a",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm"
};
const SUPPORTED_AUDIO_CONTENT_TYPES = new Set(Object.values(AUDIO_CONTENT_TYPES));

export async function listFocusAudioTracks(includeDisabled = false): Promise<FocusAudioTrack[]> {
  if (!supabase) return [];
  let query = supabase.from("focus_audio_tracks").select("*").order("sort_order").order("created_at");
  if (!includeDisabled) query = query.eq("is_enabled", true);
  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST205" || error.message.includes("schema cache")) throw new Error("专注音频服务正在初始化，请稍后刷新。");
    throw new Error(error.message || "读取专注音频失败。");
  }
  return (data ?? []) as FocusAudioTrack[];
}

export function focusAudioPublicUrl(storagePath: string): string {
  if (!supabase || !storagePath) return "";
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export async function uploadFocusAudioTrack(input: {
  file: File;
  title: string;
  kind: FocusAudioKind;
}): Promise<FocusAudioTrack> {
  if (!supabase) throw new Error("云端服务未配置，无法上传音频。");
  if (!isSupportedFocusAudioFile(input.file)) throw new Error("请选择 MP3、M4A、MP4、OGG、WAV 或 WebM 音频文件。");
  const title = input.title.trim();
  if (!title) throw new Error("请填写音频名称。");
  const extension = safeExtension(input.file.name);
  const contentType = SUPPORTED_AUDIO_CONTENT_TYPES.has(input.file.type)
    ? input.file.type
    : AUDIO_CONTENT_TYPES[extension];
  const storagePath = `${input.kind}/${crypto.randomUUID()}${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, input.file, {
    cacheControl: "3600",
    contentType,
    upsert: false
  });
  if (uploadError) throw new Error(uploadError.message || "音频上传失败。");

  const { data, error } = await supabase.from("focus_audio_tracks").insert({
    title,
    kind: input.kind,
    storage_path: storagePath,
    mime_type: contentType,
    file_size: input.file.size,
    is_enabled: true
  }).select("*").single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(error.message || "保存音频信息失败。");
  }
  return data as FocusAudioTrack;
}

export async function setFocusAudioEnabled(trackId: string, enabled: boolean): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置。");
  const { error } = await supabase.from("focus_audio_tracks").update({ is_enabled: enabled }).eq("id", trackId);
  if (error) throw new Error(error.message || "更新音频状态失败。");
}

export async function deleteFocusAudioTrack(track: FocusAudioTrack): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置。");
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([track.storage_path]);
  if (storageError) throw new Error(storageError.message || "删除音频文件失败。");
  const { error } = await supabase.from("focus_audio_tracks").delete().eq("id", track.id);
  if (error) throw new Error(error.message || "删除音频信息失败。");
}

export function formatAudioFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isSupportedFocusAudioFile(file: File): boolean {
  const extension = safeExtension(file.name);
  return SUPPORTED_AUDIO_CONTENT_TYPES.has(file.type) || extension in AUDIO_CONTENT_TYPES;
}

function safeExtension(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match?.[0] ?? "";
}
