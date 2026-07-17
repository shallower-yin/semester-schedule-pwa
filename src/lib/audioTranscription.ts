import type { DeepSeekAssistantHistoryMessage } from "./deepSeekAssistant";
import { supabase } from "./supabase";

export type AudioLanguage = "auto" | "zh" | "en";

export interface AudioConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface AudioTranscriptionResult {
  transcript: string;
  summary: string | null;
  warning?: string | null;
  model: string;
  access?: string;
  files?: string[];
  conversation?: AudioConversationMessage[];
}

interface SingleAudioTranscriptionResult extends AudioTranscriptionResult {
  quota?: unknown;
}

interface AudioUploadTicket {
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
}

interface UploadedAudio {
  name: string;
  mimeType: string;
  size: number;
  objectKey: string;
}

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_FILES = 6;

export async function transcribeAudioFiles(input: {
  files: File[];
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  onProgress?: (completed: number, total: number, fileName: string) => void;
}): Promise<AudioTranscriptionResult> {
  if (!input.files.length) throw new Error("请选择要转写的音频文件。");
  if (input.files.length > MAX_AUDIO_FILES) throw new Error(`一次最多选择 ${MAX_AUDIO_FILES} 个音频文件。`);
  input.files.forEach(validateAudioFile);

  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const uploaded: UploadedAudio[] = [];
  let submitted = false;
  try {
    for (let index = 0; index < input.files.length; index += 1) {
      const file = input.files[index];
      input.onProgress?.(index, input.files.length, file.name);
      uploaded.push(await uploadAudioFile(file, input.accessCode));
      input.onProgress?.(index + 1, input.files.length, file.name);
    }
    submitted = true;
    const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
      body: {
        mode: "audio_transcription",
        audios: uploaded,
        audioLanguage: input.language,
        summarizeAudio: input.summarize,
        accessCode: input.accessCode?.trim() || undefined
      }
    });
    if (error) throw new Error(await audioFunctionError(error));
    if (!data?.transcript?.trim()) throw new Error("没有识别到有效语音内容。");
    return {
      ...data,
      files: input.files.map((file) => file.name),
      conversation: []
    };
  } finally {
    if (!submitted && uploaded.length) {
      await Promise.allSettled(uploaded.map((audio) => deleteUploadedAudio(audio.objectKey)));
    }
  }
}

export async function transcribeAudio(input: {
  file: File;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
}): Promise<SingleAudioTranscriptionResult> {
  return await transcribeAudioFiles({
    files: [input.file],
    language: input.language,
    summarize: input.summarize,
    accessCode: input.accessCode
  }) as SingleAudioTranscriptionResult;
}

export async function askAboutAudioTranscript(input: {
  transcript: string;
  question: string;
  history?: AudioConversationMessage[];
  accessCode?: string;
}): Promise<{ answer: string; model: string; access?: string }> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法询问音频内容。");
  const history: DeepSeekAssistantHistoryMessage[] = (input.history ?? [])
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 800) }));
  const { data, error } = await supabase.functions.invoke<{ answer: string; model: string; access?: string }>("ai-assistant", {
    body: {
      mode: "audio_followup",
      question: input.question.trim(),
      audioTranscript: input.transcript.slice(0, 32_000),
      history,
      accessCode: input.accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.answer?.trim()) throw new Error("没有生成有效回答，请换一种问法重试。");
  return data;
}

export function validateAudioFile(file: File): void {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["mp3", "wav", "flac", "m4a", "ogg"].includes(extension)) {
    throw new Error("音频转写仅支持 MP3、WAV、FLAC、M4A 和 OGG 文件。");
  }
  if (file.size <= 0) throw new Error("音频文件为空。");
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`“${file.name}”不能超过 100 MB，请压缩或拆分后重试。`);
}

function normalizedAudioMimeType(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    m4a: "audio/mp4",
    ogg: "audio/ogg"
  } as Record<string, string>)[extension ?? ""] ?? (file.type || "application/octet-stream");
}

async function uploadAudioFile(file: File, accessCode?: string): Promise<UploadedAudio> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法上传音频。");
  const mimeType = normalizedAudioMimeType(file);
  const { data, error } = await supabase.functions.invoke<AudioUploadTicket>("ai-assistant", {
    body: {
      action: "create_audio_upload",
      audio: { name: file.name, mimeType, size: file.size },
      accessCode: accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.uploadUrl || !data.objectKey) throw new Error("没有获取到有效的音频上传地址。");
  const response = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: file
  });
  if (!response.ok) throw new Error(`音频上传失败（HTTP ${response.status}）。`);
  return { name: file.name, mimeType, size: file.size, objectKey: data.objectKey };
}

async function deleteUploadedAudio(objectKey: string): Promise<void> {
  if (!supabase) return;
  await supabase.functions.invoke("ai-assistant", {
    body: { action: "delete_audio_upload", audio: { objectKey } }
  });
}

async function audioFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "音频处理失败。";
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      // Use the public fallback below.
    }
  }
  return fallback.includes("non-2xx") ? "音频处理失败，请稍后重试。" : fallback;
}
