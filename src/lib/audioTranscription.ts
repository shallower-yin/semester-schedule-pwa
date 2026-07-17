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

const MAX_AUDIO_BYTES = 7 * 1024 * 1024;
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

  const parts: SingleAudioTranscriptionResult[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    input.onProgress?.(index, input.files.length, file.name);
    parts.push(await transcribeAudio({
      file,
      language: input.language,
      summarize: false,
      accessCode: input.accessCode
    }));
    input.onProgress?.(index + 1, input.files.length, file.name);
  }

  const transcript = parts.map((part, index) => input.files.length === 1
    ? part.transcript
    : `【第 ${index + 1} 段：${input.files[index].name}】\n${part.transcript}`
  ).join("\n\n");
  let summary: string | null = null;
  let warning: string | null = null;
  let model = Array.from(new Set(parts.map((part) => part.model))).join(" + ");
  let access = parts.find((part) => part.access)?.access;
  if (input.summarize) {
    try {
      const response = await askAboutAudioTranscript({
        transcript,
        question: "请将以上多段录音视为同一场连续内容，按顺序整理主题、要点、结论和明确待办。没有的信息不要补充。",
        accessCode: input.accessCode
      });
      summary = response.answer;
      model = `${model} + ${response.model}`;
      access = response.access ?? access;
    } catch {
      warning = "转写已完成，但摘要生成失败。你仍可在下方继续提问。";
    }
  }
  return {
    transcript,
    summary,
    warning,
    model,
    access,
    files: input.files.map((file) => file.name),
    conversation: []
  };
}

export async function transcribeAudio(input: {
  file: File;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
}): Promise<SingleAudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  validateAudioFile(input.file);
  const dataUrl = await fileToDataUrl(input.file);
  const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
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
  if (extension !== "mp3" && extension !== "wav") throw new Error("音频转写仅支持 MP3 和 WAV 文件。");
  if (file.size <= 0) throw new Error("音频文件为空。");
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`“${file.name}”不能超过 7 MB，请压缩或拆分后重试。`);
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
