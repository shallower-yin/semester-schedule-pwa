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

interface AudioPlanTask {
  fileIndex: number;
  fileName: string;
  objectKey: string;
  chunkIndex: number;
  chunkCount: number;
  language: AudioLanguage;
  nominalStart: number;
  nominalEnd: number;
  fetchStart: number;
  fetchEnd: number;
  signature: string;
}

interface AudioPlanResult {
  strategy: "progressive" | "single";
  totalChunks: number;
  tasks: AudioPlanTask[];
}

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_FILES = 6;
/**
 * After long M4A is split into speech-WAV parts for upload.
 * Parts are sized under the ASR 7MB request budget so the Edge Function does not
 * re-download 40MB blobs and time out with a useless generic M4A error.
 */
export const MAX_PREPARED_AUDIO_FILES = 80;

/**
 * Progress stages:
 * - upload: completed/total are file counts, step is file name
 * - transcribe: completed/total are chunk counts, step is "转写中"
 * - finalize: completed >= total, step is "整理结果" / "转写中"
 */
export async function transcribeAudioFiles(input: {
  files: File[];
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, step: string) => void;
  onUploadProgress?: (percent: number, fileName: string) => void;
}): Promise<AudioTranscriptionResult> {
  if (!input.files.length) throw new Error("请选择要转写的音频文件。");
  if (input.files.length > MAX_AUDIO_FILES) throw new Error(`一次最多选择 ${MAX_AUDIO_FILES} 个音频文件。`);
  input.files.forEach(validateAudioFile);

  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const uploaded: UploadedAudio[] = [];
  // After transcription starts successfully we keep R2 objects for 7-day lifecycle.
  // Only clean up early when upload/prep fails before a successful ASR handoff.
  let retainUploadedObjects = false;
  try {
    // M4A/OGG/FLAC over the ASR chunk limit often fail as raw container bytes; convert to compact mono speech WAV first.
    // prepared[] is strictly chronological: source-file order, then time order within each converted file.
    const prepared = await prepareFilesForAsr(input.files, input.onProgress);
    if (prepared.length > MAX_PREPARED_AUDIO_FILES) {
      throw new Error(`转换后分段过多（${prepared.length} 段），请先把录音拆成更短的文件再试。`);
    }
    for (let index = 0; index < prepared.length; index += 1) {
      const part = prepared[index];
      input.onProgress?.(index, prepared.length, part.file.name);
      uploaded.push(await uploadAudioFile(part.file, input.accessCode, input.signal, input.onUploadProgress));
      input.onProgress?.(index + 1, prepared.length, part.file.name);
    }

    // Many small converted WAV parts: orchestrate per-file ASR on the client so one Edge
    // invocation does not download/process dozens of megabytes and time out with a vague error.
    if (prepared.length > 1) {
      const sequential = await transcribeUploadedSequentially({
        uploaded,
        language: input.language,
        summarize: input.summarize,
        accessCode: input.accessCode,
        signal: input.signal,
        onProgress: input.onProgress,
        orderLabels: prepared.map((part) => part.orderLabel),
        fileNames: prepared.map((part) => part.file.name)
      });
      retainUploadedObjects = true;
      return sequential;
    }

    const plan = await planAudioTranscription(uploaded, input.language, input.accessCode, input.signal);
    if (plan.strategy === "progressive" && plan.tasks.length) {
      try {
        const progressive = await runProgressiveTranscription({
          uploaded,
          plan,
          language: input.language,
          summarize: input.summarize,
          accessCode: input.accessCode,
          signal: input.signal,
          onProgress: input.onProgress,
          fileNames: prepared.map((part) => part.file.name)
        });
        retainUploadedObjects = true;
        return progressive;
      } catch (progressiveError) {
        // Fall back to the proven single server job so web 100MB MP3 still works if progressive fails.
        if (input.signal?.aborted) throw progressiveError;
        input.onProgress?.(0, 1, "转写中");
        const fallback = await invokeSingleTranscription(uploaded, input.language, input.summarize, input.accessCode, input.signal);
        retainUploadedObjects = true;
        input.onProgress?.(1, 1, "整理结果");
        return {
          ...fallback,
          files: prepared.map((part) => part.file.name),
          conversation: []
        };
      }
    }

    input.onProgress?.(0, 1, "转写中");
    const data = await invokeSingleTranscription(uploaded, input.language, input.summarize, input.accessCode, input.signal);
    retainUploadedObjects = true;
    input.onProgress?.(1, 1, "整理结果");
    return {
      ...data,
      files: prepared.map((part) => part.file.name),
      conversation: []
    };
  } finally {
    if (!retainUploadedObjects && uploaded.length) {
      await Promise.allSettled(uploaded.map((audio) => deleteUploadedAudio(audio.objectKey)));
    }
  }
}

async function invokeSingleTranscription(
  uploaded: UploadedAudio[],
  language: AudioLanguage,
  summarize: boolean,
  accessCode: string | undefined,
  signal?: AbortSignal
): Promise<SingleAudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
    signal,
    body: {
      mode: "audio_transcription",
      audios: uploaded,
      audioLanguage: language,
      summarizeAudio: summarize,
      accessCode: accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.transcript?.trim()) throw new Error("没有识别到有效语音内容。");
  return data;
}

/**
 * One Edge job per prepared part, strictly in chronological prepared[] order.
 * R2 objects are retained until the bucket lifecycle expires ai-audio/ (7 days).
 * Network flukes retry; a failed middle part no longer aborts later parts.
 */
async function transcribeUploadedSequentially(input: {
  uploaded: UploadedAudio[];
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, step: string) => void;
  orderLabels: string[];
  fileNames: string[];
}): Promise<AudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const total = Math.max(1, input.uploaded.length);
  // Fixed-length array keeps segment i aligned with prepared part i (chronological).
  const segments: Array<string | null> = Array.from({ length: total }, () => null);
  const failedParts: string[] = [];
  let lastModel = "mimo-v2.5-asr-chunked";
  let cancelled = false;

  for (let index = 0; index < input.uploaded.length; index += 1) {
    if (input.signal?.aborted) {
      cancelled = true;
      break;
    }
    input.onProgress?.(index + 1, total, "转写中");
    try {
      const one = await invokeSingleTranscriptionWithRetry(
        [input.uploaded[index]],
        input.language,
        false,
        input.accessCode,
        input.signal
      );
      segments[index] = one.transcript.trim();
      lastModel = one.model || lastModel;
    } catch (error) {
      if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        cancelled = true;
        break;
      }
      const message = error instanceof Error ? error.message : "分段转写失败";
      failedParts.push(`第 ${index + 1}/${total} 段：${message}`);
      segments[index] = null;
    }
  }

  const successCount = segments.filter((text) => Boolean(text?.trim())).length;
  if (!successCount) {
    if (cancelled) throw new DOMException("操作已取消。", "AbortError");
    throw new Error(failedParts[0] || "没有识别到有效语音内容。");
  }

  // Always join in prepared order (0..total-1), including failure placeholders, so later
  // successful parts never appear "before" an earlier failed gap.
  const transcript = joinSequentialTranscripts(input.orderLabels, segments);
  const partialError = failedParts.length || cancelled
    ? [
        `转写已部分完成（${successCount}/${total} 段）`,
        cancelled ? "后续分段因取消未继续。" : null,
        failedParts.length ? failedParts.slice(0, 3).join("；") + (failedParts.length > 3 ? ` 等共 ${failedParts.length} 段失败。` : "") : null
      ].filter(Boolean).join("。")
    : null;
  const base: AudioTranscriptionResult = {
    transcript,
    summary: null,
    warning: partialError,
    model: lastModel,
    files: input.fileNames,
    conversation: []
  };

  if (!input.summarize || partialError) {
    return base;
  }

  input.onProgress?.(total, total, "整理结果");
  try {
    // Summary only over successful segments; order labels remain chronological.
    const successAudios = input.uploaded
      .map((audio, index) => ({ audio, text: segments[index], index }))
      .filter((item) => Boolean(item.text?.trim()));
    const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
      signal: input.signal,
      body: {
        action: "finalize_audio_transcription",
        audios: successAudios.map(({ audio }) => ({
          name: audio.name,
          mimeType: audio.mimeType,
          size: Math.max(1, audio.size),
          objectKey: audio.objectKey
        })),
        audioSegmentResults: successAudios.map(({ audio, text }) => ({
          name: audio.name,
          objectKey: audio.objectKey,
          segments: [text || ""]
        })),
        summarizeAudio: true,
        skipAudioObjectCleanup: true,
        accessCode: input.accessCode?.trim() || undefined
      }
    });
    if (error) {
      return {
        ...base,
        warning: `转写已完成，但摘要生成失败：${await audioFunctionError(error)}`
      };
    }
    return {
      ...base,
      // Keep client chronological transcript; only adopt server summary/warning/model.
      summary: data?.summary ?? null,
      warning: data?.warning ?? null,
      model: data?.model || lastModel
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "摘要生成失败";
    return {
      ...base,
      warning: `转写已完成，但摘要生成失败：${message}`
    };
  }
}

const SEQUENTIAL_ASR_ATTEMPTS = 3;

async function invokeSingleTranscriptionWithRetry(
  uploaded: UploadedAudio[],
  language: AudioLanguage,
  summarize: boolean,
  accessCode: string | undefined,
  signal?: AbortSignal
): Promise<SingleAudioTranscriptionResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < SEQUENTIAL_ASR_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
      return await invokeSingleTranscription(uploaded, language, summarize, accessCode, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lastError = error instanceof Error ? error : new Error(String(error || "分段转写失败"));
      if (attempt + 1 < SEQUENTIAL_ASR_ATTEMPTS) {
        await delay(600 + attempt * 700);
      }
    }
  }
  throw lastError ?? new Error("分段转写失败");
}

/**
 * Join segments in array order (chronological). null = failed placeholder.
 * Labels should already encode time order (e.g. 第 3/22 段 · 约 6:32–9:48).
 */
export function joinSequentialTranscripts(
  orderLabels: string[],
  segments: Array<string | null>
): string {
  const count = Math.max(orderLabels.length, segments.length);
  if (count === 0) return "";
  if (count === 1 && segments[0]?.trim()) return segments[0]!.trim();
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = orderLabels[index] || `第 ${index + 1} 段`;
    const text = segments[index]?.trim() ?? "";
    parts.push(text ? `【${label}】\n${text}` : `【${label}】\n（本段转写失败，已跳过）`);
  }
  return parts.join("\n\n");
}

export function formatAudioClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface PreparedAudioPart {
  file: File;
  /** Human-readable chronological label used when joining transcripts. */
  orderLabel: string;
}

/**
 * Convert container formats that ASR rejects after naive splitting.
 * Prefer 16 kHz mono (speech-ASR standard) and split long audio into multiple
 * upload-safe WAV parts instead of lowering quality or sending one huge file.
 * Output order is always: input file order, then time order within each file.
 */
async function prepareFilesForAsr(
  files: File[],
  onProgress?: (completed: number, total: number, step: string) => void
): Promise<PreparedAudioPart[]> {
  const prepared: PreparedAudioPart[] = [];
  const multiSource = files.length > 1;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const needsConversion = file.size > 7_000_000 && ["m4a", "ogg", "flac"].includes(extension);
    if (!needsConversion) {
      const prefix = multiSource ? `文件${fileIndex + 1}/${files.length} · ` : "";
      prepared.push({
        file,
        orderLabel: `${prefix}${file.name}`
      });
      continue;
    }
    onProgress?.(0, 1, `正在将 ${file.name} 转为 16kHz 语音 WAV 并分段…`);
    try {
      const parts = await convertAudioFileToSpeechParts(file, onProgress);
      const sourcePrefix = multiSource ? `文件${fileIndex + 1}/${files.length} · ` : "";
      for (const part of parts) {
        prepared.push({
          file: part.file,
          orderLabel: `${sourcePrefix}${part.orderLabel}`
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "转换失败";
      throw new Error(`“${file.name}”无法自动转换为可转写格式（${reason}）。请先导出为标准 MP3 后重试。`);
    }
  }
  return prepared;
}

/** 16 kHz mono speech is the usual ASR operating point for clear speech. */
export const SPEECH_ASR_SAMPLE_RATE = 16_000;
/**
 * Keep each converted WAV under MiMo ASR's ~7MB raw-chunk budget (base64 ~9.3MB).
 * Larger parts upload OK (100MB gate) but the server then re-splits/downloads and often fails.
 */
export const SPEECH_WAV_PART_TARGET_BYTES = 6 * 1024 * 1024;

export interface ConvertedSpeechPart {
  file: File;
  orderLabel: string;
  startSec: number;
  endSec: number;
  partIndex: number;
  partCount: number;
}

/** Browser-only: decode → mono PCM → pure JS time-slice → 16 kHz WAV parts. No OfflineAudioContext. */
export async function convertAudioFileToSpeechParts(
  file: File,
  onProgress?: (completed: number, total: number, step: string) => void
): Promise<ConvertedSpeechPart[]> {
  if (typeof AudioContext === "undefined" && typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === "undefined") {
    throw new Error("当前环境不支持音频解码");
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  try {
    const bytes = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    // Mix once so every part shares the same chronological mono timeline.
    const mono = mixToMonoSamples(decoded);
    // Prefer sample-accurate duration from PCM length; decodeAudioData.duration can be wrong on some WebViews for M4A.
    const duration = Math.max(0.01, mono.samples.length / mono.sampleRate, decoded.duration || 0);
    const partSeconds = maxSpeechWavPartSeconds(SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES);
    const partCount = Math.max(1, Math.ceil(duration / partSeconds));
    const baseName = file.name.replace(/\.[^.]+$/, "") || "audio";
    const indexWidth = Math.max(2, String(partCount).length);
    const parts: ConvertedSpeechPart[] = [];

    for (let index = 0; index < partCount; index += 1) {
      const startSec = index * partSeconds;
      const lengthSec = Math.min(partSeconds, duration - startSec);
      if (lengthSec <= 0.01) break;
      const endSec = startSec + lengthSec;
      onProgress?.(index, partCount, `转换分段 ${index + 1}/${partCount}…`);
      // Deterministic frame slice + linear resample. Do NOT use OfflineAudioContext start(offset):
      // Android WebView / some Chromium builds mis-map offset across sample-rate conversion and can
      // feed ASR the wrong time region while still producing fluent (but misplaced) text.
      const resampled = sliceAndResampleMono(
        mono.samples,
        mono.sampleRate,
        startSec,
        lengthSec,
        SPEECH_ASR_SAMPLE_RATE
      );
      const wav = encodeMonoWav(resampled, SPEECH_ASR_SAMPLE_RATE);
      if (wav.size > MAX_AUDIO_BYTES) {
        throw new Error(`第 ${index + 1} 段转换后仍超过 100 MB（约 ${formatMegabytes(wav.size)}）`);
      }
      // p000/p001 prefix keeps chronological order even if anything later sorts by file name.
      const orderPrefix = `p${String(index).padStart(indexWidth, "0")}`;
      const orderLabel = partCount > 1
        ? `第 ${index + 1}/${partCount} 段 · 约 ${formatAudioClock(startSec)}–${formatAudioClock(endSec)}`
        : file.name;
      parts.push({
        file: new File([wav], `${orderPrefix}_${baseName}.wav`, { type: "audio/wav" }),
        orderLabel,
        startSec,
        endSec,
        partIndex: index,
        partCount
      });
      onProgress?.(index + 1, partCount, `转换分段 ${index + 1}/${partCount}…`);
    }
    if (!parts.length) throw new Error("转换结果为空");
    return parts;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function maxSpeechWavPartSeconds(sampleRate: number, targetBytes: number): number {
  const payload = Math.max(sampleRate * 2, targetBytes - 44);
  return Math.max(30, Math.floor(payload / (sampleRate * 2)));
}

/** Mix multi-channel AudioBuffer to a single chronological Float32Array. */
export function mixToMonoSamples(buffer: AudioBuffer): { samples: Float32Array; sampleRate: number } {
  const length = buffer.length;
  const channels = Math.max(1, buffer.numberOfChannels);
  const samples = new Float32Array(length);
  if (channels === 1) {
    samples.set(buffer.getChannelData(0));
  } else {
    const inputs = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    for (let frame = 0; frame < length; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) sum += inputs[channel][frame] ?? 0;
      samples[frame] = sum / channels;
    }
  }
  return { samples, sampleRate: buffer.sampleRate };
}

/**
 * Time-slice mono PCM by source frames, then linear-resample to targetRate.
 * Pure math — no Web Audio OfflineAudioContext (avoids offset/sample-rate bugs on WebView).
 */
export function sliceAndResampleMono(
  samples: Float32Array,
  srcRate: number,
  startSec: number,
  durationSec: number,
  targetRate: number
): Float32Array {
  if (!Number.isFinite(srcRate) || srcRate <= 0) throw new Error("无效的源采样率");
  if (!Number.isFinite(targetRate) || targetRate <= 0) throw new Error("无效的目标采样率");
  const startFrame = Math.max(0, Math.min(samples.length, Math.floor(startSec * srcRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(samples.length, Math.ceil((startSec + durationSec) * srcRate)));
  const span = endFrame - startFrame;
  const outLen = Math.max(1, Math.round((span / srcRate) * targetRate));
  const out = new Float32Array(outLen);
  if (Math.abs(srcRate - targetRate) < 1e-6) {
    out.set(samples.subarray(startFrame, Math.min(endFrame, startFrame + outLen)));
    return out;
  }
  const ratio = srcRate / targetRate;
  for (let index = 0; index < outLen; index += 1) {
    const srcPos = startFrame + index * ratio;
    if (srcPos >= endFrame - 1) {
      out[index] = samples[endFrame - 1] ?? 0;
      continue;
    }
    const left = Math.floor(srcPos);
    const right = left + 1;
    const frac = srcPos - left;
    const a = samples[left] ?? 0;
    const b = samples[right] ?? a;
    out[index] = a + (b - a) * frac;
  }
  return out;
}

/** @deprecated Prefer mixToMonoSamples + sliceAndResampleMono; kept for tests/compat. */
export async function renderMonoSpeechSegment(
  buffer: AudioBuffer,
  startSec: number,
  durationSec: number,
  targetRate: number,
  _liveContext?: AudioContext
): Promise<AudioBuffer> {
  const mono = mixToMonoSamples(buffer);
  const resampled = sliceAndResampleMono(mono.samples, mono.sampleRate, startSec, durationSec, targetRate);
  if (typeof AudioBuffer !== "undefined") {
    const out = new AudioBuffer({ length: resampled.length, numberOfChannels: 1, sampleRate: targetRate });
    out.copyToChannel(resampled, 0);
    return out;
  }
  throw new Error("当前环境不支持创建音频缓冲");
}

export function mixChannelsToMonoBuffer(buffer: AudioBuffer, liveContext?: AudioContext): AudioBuffer {
  const mono = mixToMonoSamples(buffer);
  if (liveContext) {
    const out = liveContext.createBuffer(1, mono.samples.length, mono.sampleRate);
    out.getChannelData(0).set(mono.samples);
    return out;
  }
  if (typeof AudioBuffer !== "undefined") {
    const out = new AudioBuffer({ length: mono.samples.length, numberOfChannels: 1, sampleRate: mono.sampleRate });
    out.getChannelData(0).set(mono.samples);
    return out;
  }
  throw new Error("当前环境不支持创建音频缓冲");
}

/** 16-bit little-endian mono PCM WAV. */
export function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function planAudioTranscription(
  uploaded: UploadedAudio[],
  language: AudioLanguage,
  accessCode: string | undefined,
  signal?: AbortSignal
): Promise<AudioPlanResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const { data, error } = await supabase.functions.invoke<AudioPlanResult>("ai-assistant", {
    signal,
    body: {
      action: "plan_audio_transcription",
      audios: uploaded,
      audioLanguage: language,
      accessCode: accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.strategy) {
    return { strategy: "single", totalChunks: uploaded.length, tasks: [] };
  }
  return {
    strategy: data.strategy === "progressive" ? "progressive" : "single",
    totalChunks: Math.max(0, Number(data.totalChunks) || 0),
    tasks: Array.isArray(data.tasks) ? data.tasks : []
  };
}

async function runProgressiveTranscription(input: {
  uploaded: UploadedAudio[];
  plan: AudioPlanResult;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, step: string) => void;
  fileNames: string[];
}): Promise<AudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const total = Math.max(1, input.plan.totalChunks || input.plan.tasks.length);
  const segmentsByFile: string[][] = input.uploaded.map(() => []);

  // Sort by file then chunk so UI counts 1..N in natural order.
  const tasks = [...input.plan.tasks].sort((left, right) =>
    left.fileIndex === right.fileIndex ? left.chunkIndex - right.chunkIndex : left.fileIndex - right.fileIndex
  );

  for (let index = 0; index < tasks.length; index += 1) {
    if (input.signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    const task = tasks[index];
    // 1-based current chunk for UI: 1/14 … 14/14
    input.onProgress?.(index + 1, total, "转写中");
    const segment = await transcribeSignedAudioRange(task, input.signal);
    if (!segmentsByFile[task.fileIndex]) segmentsByFile[task.fileIndex] = [];
    segmentsByFile[task.fileIndex][task.chunkIndex] = segment;
    input.onProgress?.(index + 1, total, "转写中");
  }

  // Fill any holes with empty checks
  for (let fileIndex = 0; fileIndex < input.uploaded.length; fileIndex += 1) {
    const segments = (segmentsByFile[fileIndex] ?? []).map((item) => String(item ?? "").trim());
    if (!segments.length || segments.some((item) => !item)) {
      const missing = segments.findIndex((item) => !item);
      throw new Error(
        missing >= 0
          ? `音频“${input.uploaded[fileIndex].name}”第 ${missing + 1} 段转写结果缺失，请重试。`
          : `音频“${input.uploaded[fileIndex].name}”转写结果为空，请重试。`
      );
    }
    segmentsByFile[fileIndex] = segments;
  }

  input.onProgress?.(total, total, "整理结果");
  const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
    signal: input.signal,
    body: {
      action: "finalize_audio_transcription",
      audios: input.uploaded,
      audioSegmentResults: input.uploaded.map((audio, fileIndex) => ({
        name: audio.name,
        objectKey: audio.objectKey,
        segments: segmentsByFile[fileIndex]
      })),
      summarizeAudio: input.summarize,
      accessCode: input.accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.transcript?.trim()) throw new Error("没有识别到有效语音内容。");
  return {
    ...data,
    files: input.fileNames,
    conversation: []
  };
}

async function transcribeSignedAudioRange(task: AudioPlanTask, signal?: AbortSignal): Promise<string> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  // Retry a few times on the client for flaky networks while still showing chunk progress.
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
      const { data, error } = await supabase.functions.invoke<{ transcript?: string }>("ai-assistant", {
        signal,
        headers: {
          "x-audio-range-signature": task.signature
        },
        body: {
          action: "transcribe_audio_range",
          // Body fallback if custom headers are dropped by WebView / proxies.
          audioRangeSignature: task.signature,
          audioRange: {
            objectKey: task.objectKey,
            fileName: task.fileName,
            language: task.language,
            chunkIndex: task.chunkIndex,
            chunkCount: task.chunkCount,
            nominalStart: task.nominalStart,
            nominalEnd: task.nominalEnd,
            fetchStart: task.fetchStart,
            fetchEnd: task.fetchEnd
          }
        }
      });
      if (error) throw new Error(await audioFunctionError(error));
      const transcript = data?.transcript?.trim();
      if (!transcript) throw new Error(`音频“${task.fileName}”第 ${task.chunkIndex + 1}/${task.chunkCount} 段没有识别到语音。`);
      return transcript;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "分段转写失败"));
      if (signal?.aborted) throw lastError;
      // Don't retry hard client errors
      if (/权限|口令|额度|格式|签名|Invalid/.test(lastError.message)) throw lastError;
      if (attempt < 2) await delay(700 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error(`音频“${task.fileName}”第 ${task.chunkIndex + 1}/${task.chunkCount} 段转写失败。`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeAudio(input: {
  file: File;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
}): Promise<SingleAudioTranscriptionResult> {
  return await transcribeAudioFiles({
    files: [input.file],
    language: input.language,
    summarize: input.summarize,
    accessCode: input.accessCode,
    signal: input.signal
  }) as SingleAudioTranscriptionResult;
}

export async function askAboutAudioTranscript(input: {
  transcript: string;
  question: string;
  history?: AudioConversationMessage[];
  accessCode?: string;
  signal?: AbortSignal;
}): Promise<{ answer: string; model: string; access?: string }> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法询问音频内容。");
  const history: DeepSeekAssistantHistoryMessage[] = (input.history ?? [])
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 800) }));
  const { data, error } = await supabase.functions.invoke<{ answer: string; model: string; access?: string }>("ai-assistant", {
    signal: input.signal,
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

async function uploadAudioFile(
  file: File,
  accessCode?: string,
  signal?: AbortSignal,
  onUploadProgress?: (percent: number, fileName: string) => void
): Promise<UploadedAudio> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法上传音频。");
  const mimeType = normalizedAudioMimeType(file);
  const { data, error } = await supabase.functions.invoke<AudioUploadTicket>("ai-assistant", {
    signal,
    body: {
      action: "create_audio_upload",
      audio: { name: file.name, mimeType, size: file.size },
      accessCode: accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.uploadUrl || !data.objectKey) throw new Error("没有获取到有效的音频上传地址。");

  // Use XMLHttpRequest for upload progress when available (fetch does not expose upload progress).
  // In test environments (jsdom), fall back to fetch.
  // jsdom has XMLHttpRequest.prototype.upload but it never fires events.
  // Detect jsdom via userAgent and fall back to fetch.
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const hasXhrUpload = !isJsdom
    && typeof XMLHttpRequest !== "undefined"
    && typeof XMLHttpRequest.prototype !== "undefined"
    && "upload" in XMLHttpRequest.prototype;
  if (hasXhrUpload) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", data.uploadUrl, true);
      xhr.setRequestHeader("content-type", mimeType);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onUploadProgress?.(percent, file.name);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`音频上传失败（HTTP ${xhr.status}）。`));
      };
      xhr.onerror = () => reject(new Error("音频上传网络错误，请检查网络后重试。"));
      xhr.onabort = () => reject(new Error("上传已取消。"));
      if (signal) {
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });
  } else {
    // Fallback for test environments (jsdom) without XHR upload support.
    const response = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: file,
      signal
    });
    if (!response.ok) throw new Error(`音频上传失败（HTTP ${response.status}）。`);
  }

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
      const payload = await context.clone().json() as { error?: unknown; diagnosticId?: unknown; code?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        const diagnostic = typeof payload.diagnosticId === "string" && payload.diagnosticId
          ? `（诊断编号：${payload.diagnosticId.slice(0, 8)}）`
          : "";
        // Avoid double diagnostic suffix if server already appended one.
        return payload.error.includes("诊断编号") ? payload.error.trim() : `${payload.error.trim()}${diagnostic}`;
      }
    } catch {
      try {
        const text = await (context as Response).clone().text();
        if (text.trim()) return text.trim().slice(0, 300);
      } catch {
        // Use the public fallback below.
      }
    }
  }
  // Only blame the network when the client truly could not reach the function.
  if (/Failed to (send|fetch)|NetworkError|fetch failed|Load failed|超时|timeout/i.test(fallback)) {
    return "无法连接到音频处理服务，请检查网络后重试。若文件很大，可稍后再试。";
  }
  if (fallback.includes("non-2xx")) {
    // Supabase often only returns "non-2xx" when the body was not parsed; avoid blaming M4A
    // after the client already converted to WAV segments.
    return "音频处理服务返回了错误，请稍后重试。若刚完成格式转换，请保持网络稳定后再试一次。";
  }
  return fallback;
}
