import { supabase } from "./supabase";

export type AudioLanguage = "auto" | "zh" | "en";

export interface AudioTranscriptionResult {
  transcript: string;
  summary: string | null;
  warning?: string | null;
  model: string;
  access?: string;
}

const MAX_AUDIO_BYTES = 7 * 1024 * 1024;

export async function transcribeAudio(input: {
  file: File;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
}): Promise<AudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  validateAudioFile(input.file);
  const dataUrl = await fileToDataUrl(input.file);
  const { data, error } = await supabase.functions.invoke<AudioTranscriptionResult>("ai-assistant", {
    body: {
      mode: "audio_transcription",
      audio: {
        name: input.file.name,
        mimeType: normalizedAudioMimeType(input.file),
        dataUrl
      },
      audioLanguage: input.language,
      summarizeAudio: input.summarize,
      accessCode: input.accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.transcript?.trim()) throw new Error("没有识别到有效语音内容。");
  return data;
}

export function validateAudioFile(file: File): void {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "mp3" && extension !== "wav") throw new Error("音频转写仅支持 MP3 和 WAV 文件。");
  if (file.size <= 0) throw new Error("音频文件为空。");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("音频文件不能超过 7 MB，请压缩或拆分后重试。");
}

function normalizedAudioMimeType(file: File): string {
  return file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const base64 = value.split(",")[1];
      if (!base64) reject(new Error("读取音频文件失败。"));
      else resolve(`data:${normalizedAudioMimeType(file)};base64,${base64}`);
    };
    reader.onerror = () => reject(new Error("读取音频文件失败。"));
    reader.readAsDataURL(file);
  });
}

async function audioFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "音频转写失败。";
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      // Use the public fallback below.
    }
  }
  return fallback.includes("non-2xx") ? "音频转写失败，请稍后重试。" : fallback;
}
