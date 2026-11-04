import type { DeepSeekAssistantHistoryMessage } from "./deepSeekAssistant";
import { supabase } from "./supabase";
import { formatMegabytes, MAX_AUDIO_BYTES, prepareFilesForAsr } from "./audioPreparation";

// Preserve the public audio API while keeping browser preprocessing independent of uploads.
export {
  MAX_AUDIO_BYTES, formatAudioClock, splitM4aFileForAsr, convertAudioFileToSpeechParts,
  SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES, maxSpeechWavPartSeconds,
  mixToMonoSamples, sliceAndResampleMono, renderMonoSpeechSegment,
  mixChannelsToMonoBuffer, encodeMonoWav
} from "./audioPreparation";
export type { PreparedAudioPart, ConvertedSpeechPart } from "./audioPreparation";
import type { AudioSubmission } from "../../supabase/functions/_shared/audioSubmission";

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

interface AudioPartTask {
  fileIndex: number;
  fileName: string;
  objectKey: string;
  mimeType: string;
  size: number;
  language: AudioLanguage;
  partIndex: number;
  partCount: number;
  signature: string;
}
interface AudioPlanResult {
  strategy: "progressive" | "single";
  totalChunks: number;
  tasks: AudioPlanTask[];
}

interface AudioPartPlanResult {
  tasks: AudioPartTask[];
}

export const MAX_AUDIO_FILES = 6;
/**
 * After long M4A is split into speech-WAV parts for upload.
 * Parts are sized under the ASR 7MB request budget so the Edge Function does not
 * re-download 40MB blobs and time out with a useless generic M4A error.
 */
export const MAX_PREPARED_AUDIO_FILES = 80;
/** Align with server MAX_ASR_AUDIO_CHUNK_BYTES — larger MP3 must use progressive ranges. */
export const LARGE_MP3_BYTES = 7_000_000;
const MP3_RANGE_OVERLAP_BYTES = 4_096;

export function isLargeMp3Upload(file: { name: string; size: number }): boolean {
  return file.name.toLowerCase().endsWith(".mp3") && file.size > LARGE_MP3_BYTES;
}

/** How many progressive ASR ranges a large MP3 will need (UI + diagnostics). */
export function estimateLargeMp3ChunkCount(sizeBytes: number): number {
  const nominal = Math.max(1, LARGE_MP3_BYTES - MP3_RANGE_OVERLAP_BYTES * 2);
  return Math.max(1, Math.ceil(Math.max(1, sizeBytes) / nominal));
}

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
  /** Fired after each successful progressive segment so the UI can checkpoint to disk. */
  onPartialResult?: (partial: AudioTranscriptionResult) => void;
}): Promise<AudioTranscriptionResult> {
  if (!input.files.length) throw new Error("请选择要转写的音频文件。");
  if (input.files.length > MAX_AUDIO_FILES) throw new Error(`一次最多选择 ${MAX_AUDIO_FILES} 个音频文件。`);
  input.files.forEach(validateAudioFile);

  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const uploaded: UploadedAudio[] = [];
  const temporaryObjectKeys: string[] = [];
  let audioSubmission: AudioSubmission | undefined;
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
      uploaded.push(await uploadAudioFile(part.file, input.accessCode, input.signal, input.onUploadProgress,
        (objectKey) => temporaryObjectKeys.push(objectKey)));
      input.onProgress?.(index + 1, prepared.length, part.file.name);
    }

    // A new user submission gets one immutable manifest. Internal retries and
    // every processing branch below share it; a later submit gets a new ID.
    input.signal?.throwIfAborted();
    audioSubmission = { id: crypto.randomUUID(), audios: uploaded.map((audio) => ({ ...audio })),
      language: input.language, summarize: input.summarize };

    // Many small converted WAV parts: orchestrate per-file ASR on the client so one Edge
    // invocation does not download/process dozens of megabytes and time out with a vague error.
    if (prepared.length > 1) {
      const sequential = await transcribeUploadedSequentially({
        audioSubmission,
        uploaded,
        language: input.language,
        summarize: input.summarize,
        accessCode: input.accessCode,
        signal: input.signal,
        onProgress: input.onProgress,
        onPartialResult: input.onPartialResult,
        orderLabels: prepared.map((part) => part.orderLabel),
        fileNames: prepared.map((part) => part.file.name)
      });
      return sequential;
    }

    const plan = await planAudioTranscription(uploaded, input.language, input.accessCode, input.signal);
    if (plan.strategy === "progressive" && plan.tasks.length) {
      // CRITICAL: never fall back to one Edge job for the whole large MP3.
      // That shows "1/1", runs many MiMo calls server-side (billing), then the long HTTP
      // often dies on the phone → false "尚未调用语音模型" after money was spent.
      const progressive = await runProgressiveTranscription({
        audioSubmission,
        uploaded,
        plan,
        language: input.language,
        summarize: input.summarize,
        accessCode: input.accessCode,
        signal: input.signal,
        onProgress: input.onProgress,
        onPartialResult: input.onPartialResult,
        fileNames: prepared.map((part) => part.file.name)
      });
      return progressive;
    }

    const largeMp3 = uploaded.find((audio) => isLargeMp3Upload(audio));
    if (largeMp3) {
      const expected = estimateLargeMp3ChunkCount(largeMp3.size);
      throw new Error(
        `「${largeMp3.name}」约 ${formatMegabytes(largeMp3.size)}，应按约 ${expected} 段分段转写，但云端未返回分段计划。请稍后重试；不要反复整文件硬转，以免重复计费。`
      );
    }

    // Small single-file job only (progress 1/1 is correct here).
    input.onProgress?.(1, 1, "转写中");
    const data = await invokeSingleTranscription(uploaded, input.language, input.summarize, input.accessCode, input.signal, audioSubmission);
    input.onProgress?.(1, 1, "整理结果");
    return {
      ...data,
      files: prepared.map((part) => part.file.name),
      conversation: []
    };
  } finally {
    if (audioSubmission) {
      // No aborted signal here: cancellation must also close the server-side session.
      // Bound this best-effort call so it cannot prevent the existing R2 finally cleanup.
      const closeController = new AbortController();
      const closeTimeout = setTimeout(() => closeController.abort(), 5000);
      await supabase.functions.invoke("ai-assistant", {
        signal: closeController.signal,
        body: { action: "close_audio_submission", audioSubmissionId: audioSubmission.id }
      }).catch(() => undefined).finally(() => clearTimeout(closeTimeout));
    }
    if (temporaryObjectKeys.length) {
      await Promise.allSettled(temporaryObjectKeys.map((objectKey) => deleteUploadedAudio(objectKey)));
    }
  }
}

async function invokeSingleTranscription(
  uploaded: UploadedAudio[],
  language: AudioLanguage,
  summarize: boolean,
  accessCode: string | undefined,
  signal?: AbortSignal,
  audioSubmission?: AudioSubmission
): Promise<SingleAudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  // Retry only when the browser never got a response from our Edge Function (not when MiMo already ran).
  const { data, error } = await invokeAudioFunctionWithTransientRetry(
    () => supabase!.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
      signal,
      body: {
        mode: "audio_transcription",
        audioSubmission,
        audios: uploaded,
        audioLanguage: language,
        summarizeAudio: summarize,
        accessCode: accessCode?.trim() || undefined
      }
    }),
    signal,
    4
  );
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.transcript?.trim()) throw new Error("没有识别到有效语音内容。");
  return data;
}

/**
 * One Edge job per prepared part, strictly in chronological prepared[] order.
 * Network flukes retry; a failed middle part no longer aborts later parts. Every completed
 * part emits a chronological checkpoint, while the caller deletes all temporary R2 objects
 * in its terminal finally block.
 */
async function transcribeUploadedSequentially(input: {
  audioSubmission: AudioSubmission;
  uploaded: UploadedAudio[];
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, step: string) => void;
  onPartialResult?: (partial: AudioTranscriptionResult) => void;
  orderLabels: string[];
  fileNames: string[];
}): Promise<AudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const total = Math.max(1, input.uploaded.length);
  // A multi-file selection can mix short files and a large MP3. The old branch sent every file to
  // the one-shot endpoint, so a single >7MB MP3 was rejected as require_client_progressive. Plan
  // large files individually and keep the final transcript in the user's original file order.
  const progressivePlans = await Promise.all(input.uploaded.map((audio) => (
    isLargeMp3Upload(audio)
      ? planAudioTranscription([audio], input.language, input.accessCode, input.signal)
      : Promise.resolve<AudioPlanResult | null>(null)
  )));
  const signedPartCandidates = input.uploaded.filter((audio) => !isLargeMp3Upload(audio) && audio.size <= LARGE_MP3_BYTES);
  const signedPartPlan = signedPartCandidates.length
    ? await planAudioParts(signedPartCandidates, input.language, input.accessCode, input.signal)
    : { tasks: [] };
  const signedPartsByObjectKey = new Map(signedPartPlan.tasks.map((task) => [task.objectKey, task]));
  for (let index = 0; index < progressivePlans.length; index += 1) {
    const plan = progressivePlans[index];
    if (isLargeMp3Upload(input.uploaded[index]) && (!plan || plan.strategy !== "progressive" || !plan.tasks.length)) {
      throw new Error(`「${input.uploaded[index].name}」体积较大，但云端未返回分段计划。请稍后重试。`);
    }
  }
  const workUnits = progressivePlans.map((plan) => Math.max(1, plan?.tasks.length ?? 1));
  const totalWork = workUnits.reduce((sum, value) => sum + value, 0);
  let completedWork = 0;
  // Fixed-length array keeps segment i aligned with prepared part i (chronological).
  const segments: Array<string | null> = Array.from({ length: total }, () => null);
  const failedParts: string[] = [];
  let lastModel = "mimo-v2.5-asr-chunked";
  let cancelled = false;

  const buildCheckpoint = (warning?: string | null): AudioTranscriptionResult => ({
    transcript: joinSequentialTranscripts(input.orderLabels, segments),
    summary: null,
    warning: warning ?? null,
    model: lastModel,
    files: input.fileNames,
    conversation: []
  });

  for (let index = 0; index < input.uploaded.length; index += 1) {
    if (input.signal?.aborted) {
      cancelled = true;
      break;
    }
    input.onProgress?.(completedWork, totalWork, input.fileNames[index] || "转写中");
    try {
      const plan = progressivePlans[index];
      const one = plan
        ? await runProgressiveTranscription({
          audioSubmission: input.audioSubmission,
          uploaded: [input.uploaded[index]],
          plan,
          language: input.language,
          summarize: false,
          accessCode: input.accessCode,
          signal: input.signal,
          onProgress: (completed, _chunkTotal, step) => input.onProgress?.(
            Math.min(totalWork, completedWork + completed),
            totalWork,
            `${input.fileNames[index] || input.uploaded[index].name} · ${step}`
          ),
          fileNames: [input.fileNames[index] || input.uploaded[index].name]
        })
        : signedPartsByObjectKey.has(input.uploaded[index].objectKey)
          ? await transcribeSignedAudioPart(signedPartsByObjectKey.get(input.uploaded[index].objectKey)!, input.signal, input.audioSubmission, input.accessCode)
          : await invokeSingleTranscriptionWithRetry(
            [input.uploaded[index]],
            input.language,
            false,
            input.accessCode,
            input.signal,
            input.audioSubmission
          );
      segments[index] = one.transcript.trim();
      lastModel = one.model || lastModel;
      input.onPartialResult?.(buildCheckpoint(`已保存 ${segments.filter((text) => Boolean(text?.trim())).length}/${total} 段，未完成位置会继续补齐。`));
    } catch (error) {
      if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        cancelled = true;
        break;
      }
      const message = error instanceof Error ? error.message : "分段转写失败";
      failedParts.push(`第 ${index + 1}/${total} 段：${message}`);
      segments[index] = null;
      input.onPartialResult?.(buildCheckpoint(`第 ${index + 1}/${total} 段暂未成功，后续分段仍会按原顺序继续。`));
    }
    completedWork += workUnits[index];
    input.onProgress?.(completedWork, totalWork, input.fileNames[index] || "转写中");
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
  input.onPartialResult?.(base);

  if (partialError) {
    return base;
  }

  input.onProgress?.(totalWork, totalWork, "整理结果");
  try {
    // Summary only over successful segments; order labels remain chronological.
    const successAudios = input.uploaded
      .map((audio, index) => ({ audio, text: segments[index], index }))
      .filter((item) => Boolean(item.text?.trim()));
    const { data, error } = await supabase.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
      signal: input.signal,
      body: {
        action: "finalize_audio_transcription",
        audioSubmission: input.audioSubmission,
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
        summarizeAudio: input.summarize,
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
  signal?: AbortSignal,
  audioSubmission?: AudioSubmission
): Promise<SingleAudioTranscriptionResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < SEQUENTIAL_ASR_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
      return await invokeSingleTranscription(uploaded, language, summarize, accessCode, signal, audioSubmission);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lastError = error instanceof Error ? error : new Error(String(error || "分段转写失败"));
      // Only re-attempt when the message still looks like a client↔Edge connectivity problem.
      // Business errors (quota, format, 4xx body text) should fail the segment once.
      const retryable = /无法连接|尚未调用|超时|网络|Failed to|fetch|timeout/i.test(lastError.message);
      if (!retryable || attempt + 1 >= SEQUENTIAL_ASR_ATTEMPTS) break;
      await delay(600 + attempt * 700);
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

async function planAudioParts(
  uploaded: UploadedAudio[],
  language: AudioLanguage,
  accessCode: string | undefined,
  signal?: AbortSignal
): Promise<AudioPartPlanResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const { data, error } = await supabase.functions.invoke<AudioPartPlanResult>("ai-assistant", {
    signal,
    body: {
      action: "plan_audio_parts",
      audios: uploaded,
      audioLanguage: language,
      accessCode: accessCode?.trim() || undefined
    }
  });
  if (error) throw new Error(await audioFunctionError(error));
  return { tasks: Array.isArray(data?.tasks) ? data.tasks : [] };
}

async function runProgressiveTranscription(input: {
  audioSubmission: AudioSubmission;
  uploaded: UploadedAudio[];
  plan: AudioPlanResult;
  language: AudioLanguage;
  summarize: boolean;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, step: string) => void;
  onPartialResult?: (partial: AudioTranscriptionResult) => void;
  fileNames: string[];
}): Promise<AudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  const total = Math.max(1, input.plan.totalChunks || input.plan.tasks.length);
  const segmentsByFile: Array<Array<string | null>> = input.uploaded.map(() => []);
  const segmentErrors: string[] = [];
  let cancelled = false;

  // Sort by file then chunk so UI counts 1..N in natural order (e.g. 1/8 … 8/8 for ~50MB MP3).
  const tasks = [...input.plan.tasks].sort((left, right) =>
    left.fileIndex === right.fileIndex ? left.chunkIndex - right.chunkIndex : left.fileIndex - right.fileIndex
  );

  const orderLabels = tasks.map((task) => (
    tasks.length > 1
      ? `第 ${task.chunkIndex + 1}/${task.chunkCount} 段`
      : input.fileNames[task.fileIndex] || task.fileName
  ));

  const emitProgress = (current: number, succeeded: number, phase: string) => {
    // Put the human string in `step` so the dialog never confuses "attempted" with "succeeded".
    input.onProgress?.(
      current,
      total,
      `${phase} ${current}/${total}（已成功 ${succeeded}/${total}）`
    );
  };

  const buildPartial = (extraWarning?: string | null): AudioTranscriptionResult => {
    const ordered = tasks.map((task) => segmentsByFile[task.fileIndex]?.[task.chunkIndex] ?? null);
    const successCount = ordered.filter((text) => Boolean(text?.trim())).length;
    const missing = ordered
      .map((text, index) => (text?.trim() ? null : index + 1))
      .filter((value): value is number => value !== null);
    const warningParts = [
      successCount < total ? `转写已完成 ${successCount}/${total} 段` : null,
      missing.length ? `未成功：第 ${missing.slice(0, 8).join("、")}${missing.length > 8 ? "…" : ""} 段` : null,
      extraWarning || null
    ].filter(Boolean);
    return {
      transcript: joinSequentialTranscripts(orderLabels, ordered),
      summary: null,
      warning: warningParts.length ? warningParts.join("。") + "。" : null,
      model: "mimo-v2.5-asr-chunked",
      files: input.fileNames,
      conversation: []
    };
  };

  const runOneTask = async (task: AudioPlanTask, index: number): Promise<void> => {
    if (input.signal?.aborted) {
      cancelled = true;
      return;
    }
    const succeededBefore = tasks.filter((item, taskIndex) =>
      taskIndex < index && Boolean(segmentsByFile[item.fileIndex]?.[item.chunkIndex]?.trim())
    ).length;
    emitProgress(index + 1, succeededBefore, "正在转写");
    try {
      const segment = await transcribeSignedAudioRange(task, input.signal, input.audioSubmission, input.accessCode);
      if (!segmentsByFile[task.fileIndex]) segmentsByFile[task.fileIndex] = [];
      segmentsByFile[task.fileIndex][task.chunkIndex] = segment;
      const succeeded = tasks.filter((item) =>
        Boolean(segmentsByFile[item.fileIndex]?.[item.chunkIndex]?.trim())
      ).length;
      emitProgress(index + 1, succeeded, "正在转写");
      // Checkpoint after every success so a later network blip never wipes finished text.
      input.onPartialResult?.(buildPartial(null));
    } catch (error) {
      if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        cancelled = true;
        return;
      }
      const message = error instanceof Error ? error.message : String(error || "分段转写失败");
      segmentErrors[index] = `第 ${index + 1}/${total} 段失败：${message}`;
      if (!segmentsByFile[task.fileIndex]) segmentsByFile[task.fileIndex] = [];
      segmentsByFile[task.fileIndex][task.chunkIndex] = null;
      const succeeded = tasks.filter((item) =>
        Boolean(segmentsByFile[item.fileIndex]?.[item.chunkIndex]?.trim())
      ).length;
      emitProgress(index + 1, succeeded, "正在转写");
    }
  };

  // Pass 1: sequential ASR for every range.
  for (let index = 0; index < tasks.length; index += 1) {
    if (cancelled || input.signal?.aborted) {
      cancelled = true;
      break;
    }
    await runOneTask(tasks[index], index);
  }

  // Pass 2: only retry holes (cost OK — user asked for completion over thrift).
  if (!cancelled && !input.signal?.aborted) {
    const missingIndexes = tasks
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => !segmentsByFile[task.fileIndex]?.[task.chunkIndex]?.trim());
    for (const { task, index } of missingIndexes) {
      if (input.signal?.aborted) {
        cancelled = true;
        break;
      }
      emitProgress(index + 1, tasks.filter((item) =>
        Boolean(segmentsByFile[item.fileIndex]?.[item.chunkIndex]?.trim())
      ).length, "补救转写");
      await runOneTask(task, index);
    }
  }

  const orderedSegments = tasks.map((task) => segmentsByFile[task.fileIndex]?.[task.chunkIndex] ?? null);
  const successCount = orderedSegments.filter((text) => Boolean(text?.trim())).length;
  if (!successCount) {
    if (cancelled) throw new DOMException("操作已取消。", "AbortError");
    const detail = segmentErrors.filter(Boolean).slice(0, 3).join("；")
      || "各分段均未返回正文（常见原因：MP3 分段抽帧失败、签名无效或云端超时）。";
    throw new Error(`全部分段均未识别成功。${detail}`);
  }

  // Transcript is assembled ONLY on the client — never depends on a final network call.
  const base = buildPartial(
    cancelled ? "后续分段因取消未继续" : successCount < total ? null : null
  );
  input.onPartialResult?.(base);

  if (!input.summarize) {
    return base;
  }

  // Summary is strictly optional. Connection loss here must NOT fail the whole job.
  emitProgress(total, successCount, "整理摘要");
  try {
    const summary = await summarizeJoinedTranscript(base.transcript, input.accessCode, input.signal, input.audioSubmission);
    if (summary) {
      const withSummary = {
        ...base,
        summary,
        model: `mimo-v2.5-asr-chunked + summary`,
        warning: successCount < total ? base.warning : null
      };
      input.onPartialResult?.(withSummary);
      return withSummary;
    }
    return {
      ...base,
      warning: [base.warning, "正文已保留，摘要生成未完成（可稍后对正文继续提问）。"].filter(Boolean).join("")
    };
  } catch {
    return {
      ...base,
      warning: [base.warning, "正文已保留，摘要生成未完成（可稍后对正文继续提问）。"].filter(Boolean).join("")
    };
  }
}

/** Text-only summary via dedicated action — no R2, cannot kill an already-finished transcript. */
async function summarizeJoinedTranscript(
  transcript: string,
  accessCode: string | undefined,
  signal?: AbortSignal,
  audioSubmission?: AudioSubmission
): Promise<string | null> {
  if (!supabase || !transcript.trim()) return null;
  const { data, error } = await invokeAudioFunctionWithTransientRetry(
    () => supabase!.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
      signal,
      body: {
        action: "summarize_audio_transcript",
        audioSubmission,
        audioTranscript: transcript,
        accessCode: accessCode?.trim() || undefined
      }
    }),
    signal,
    3
  );
  if (error || !data?.summary?.trim()) return null;
  return data.summary.trim();
}

async function transcribeSignedAudioRange(task: AudioPlanTask, signal?: AbortSignal, audioSubmission?: AudioSubmission, accessCode?: string): Promise<string> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  // Aggressive retries: cost is acceptable; finishing the transcript is the priority.
  let lastError: Error | null = null;
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
      const { data, error } = await invokeAudioFunctionWithTransientRetry(
        () => supabase!.functions.invoke<{ transcript?: string }>("ai-assistant", {
          signal,
          headers: {
            "x-audio-range-signature": task.signature
          },
          body: {
            action: "transcribe_audio_range",
            audioSubmission,
            accessCode: accessCode?.trim() || undefined,
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
        }),
        signal,
        3
      );
      if (error) throw new Error(await audioFunctionError(error));
      const transcript = data?.transcript?.trim();
      if (!transcript) throw new Error(`音频“${task.fileName}”第 ${task.chunkIndex + 1}/${task.chunkCount} 段没有识别到语音。`);
      return transcript;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "分段转写失败"));
      if (signal?.aborted) throw lastError;
      // Don't retry hard client errors
      if (/权限|口令|额度|格式|签名|Invalid|未开放|不能超过/.test(lastError.message)) throw lastError;
      if (attempt + 1 < maxAttempts) {
        // Up to ~20s backoff for flaky mobile networks.
        await delay(Math.min(12_000, 900 * 2 ** attempt) + Math.floor(Math.random() * 500));
      }
    }
  }
  throw lastError ?? new Error(`音频“${task.fileName}”第 ${task.chunkIndex + 1}/${task.chunkCount} 段转写失败。`);
}

async function transcribeSignedAudioPart(task: AudioPartTask, signal?: AbortSignal, audioSubmission?: AudioSubmission, accessCode?: string): Promise<SingleAudioTranscriptionResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法转写音频。");
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
      const { data, error } = await invokeAudioFunctionWithTransientRetry(
        () => supabase!.functions.invoke<SingleAudioTranscriptionResult>("ai-assistant", {
          signal,
          headers: { "x-audio-part-signature": task.signature },
          body: {
            action: "transcribe_audio_part",
            audioSubmission,
            accessCode: accessCode?.trim() || undefined,
            audioPartSignature: task.signature,
            audioPart: {
              objectKey: task.objectKey,
              fileName: task.fileName,
              mimeType: task.mimeType,
              size: task.size,
              language: task.language,
              partIndex: task.partIndex,
              partCount: task.partCount
            }
          }
        }),
        signal,
        3
      );
      if (error) throw new Error(await audioFunctionError(error));
      if (!data?.transcript?.trim()) throw new Error(`音频“${task.fileName}”第 ${task.partIndex + 1}/${task.partCount} 段没有识别到语音。`);
      return { ...data, transcript: data.transcript.trim(), model: data.model || "mimo-v2.5-asr-signed-part" };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "分段转写失败"));
      if (signal?.aborted) throw lastError;
      if (/权限|口令|额度|格式|签名|Invalid|未开放|不能超过/.test(lastError.message)) throw lastError;
      if (attempt + 1 < 6) await delay(Math.min(12_000, 900 * 2 ** attempt) + Math.floor(Math.random() * 500));
    }
  }
  throw lastError ?? new Error(`音频“${task.fileName}”第 ${task.partIndex + 1}/${task.partCount} 段转写失败。`);
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
  onUploadProgress?: (percent: number, fileName: string) => void,
  onTicketCreated?: (objectKey: string) => void
): Promise<UploadedAudio> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法上传音频。");
  const mimeType = normalizedAudioMimeType(file);
  const { data, error } = await invokeAudioFunctionWithTransientRetry(
    () => supabase!.functions.invoke<AudioUploadTicket>("ai-assistant", {
      signal,
      body: {
        action: "create_audio_upload",
        audio: { name: file.name, mimeType, size: file.size },
        accessCode: accessCode?.trim() || undefined
      }
    }),
    signal,
    3
  );
  if (error) throw new Error(await audioFunctionError(error));
  if (!data?.uploadUrl || !data.objectKey) throw new Error("没有获取到有效的音频上传地址。");
  // A failed/aborted PUT may still have reached R2; register ownership before starting it.
  onTicketCreated?.(data.objectKey);

  // Use XMLHttpRequest for upload progress when available (fetch does not expose upload progress).
  // In test environments (jsdom), fall back to fetch.
  // jsdom has XMLHttpRequest.prototype.upload but it never fires events.
  // Detect jsdom via userAgent and fall back to fetch.
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const hasXhrUpload = !isJsdom
    && typeof XMLHttpRequest !== "undefined"
    && typeof XMLHttpRequest.prototype !== "undefined"
    && "upload" in XMLHttpRequest.prototype;
  let uploadError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    try {
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
      xhr.onerror = () => reject(new Error(
        location.protocol === "https:" && location.hostname === "localhost"
          ? "APK 音频上传被网络或 R2 跨域策略拦截，请确认存储桶 CORS 已允许 https://localhost 后重试。"
          : "音频上传网络错误，请检查网络后重试。"
      ));
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
      uploadError = null;
      break;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      uploadError = error instanceof Error ? error : new Error("音频上传失败");
      if (attempt < 2) await delay(800 * (attempt + 1));
    }
  }
  if (uploadError) throw uploadError;

  return { name: file.name, mimeType, size: file.size, objectKey: data.objectKey };
}

async function deleteUploadedAudio(objectKey: string): Promise<void> {
  if (!supabase) return;
  await supabase.functions.invoke("ai-assistant", {
    body: { action: "delete_audio_upload", audio: { objectKey } }
  });
}

/**
 * Map Supabase Functions errors to user-facing Chinese.
 *
 * Do NOT claim "语音模型尚未调用". A long Edge job can call MiMo many times (billing),
 * then the phone drops the HTTP response — console shows spend + client shows fetch error.
 */
async function audioFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "音频处理失败。";
  const name = String((error as { name?: unknown })?.name ?? "");
  const context = (error as { context?: unknown })?.context;

  if (error instanceof DOMException && error.name === "AbortError") {
    return "操作已取消。";
  }

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
    if (context.status === 504 || context.status === 408) {
      return `云端处理超时（HTTP ${context.status}）。大文件请确认进度为「N/多段」；超时前可能已产生模型费用，请只重试失败分段。`;
    }
    if (context.status >= 500) {
      return `云端转写服务暂时不可用（HTTP ${context.status}），请稍后重试。`;
    }
  }

  if (
    name === "FunctionsFetchError"
    || /Failed to (send|fetch)|NetworkError|fetch failed|Load failed|ERR_NETWORK|ECONNRESET/i.test(fallback)
  ) {
    return "与云端的连接中断。若已转写一段时间，语音模型可能已处理部分分段并产生费用；请用稳定 Wi‑Fi、保持应用在前台后重试（进度应为 1/多 段，不要只看到 1/1）。";
  }
  if (/超时|timeout|timed out/i.test(fallback)) {
    return "等待云端响应超时。大文件整包转写极易超时且可能已计费；请更新后按多段进度重试。";
  }
  if (fallback.includes("non-2xx")) {
    return "云端转写服务返回了错误，请稍后重试。";
  }
  return fallback;
}

/** Retry only when the browser never got a Response from Supabase Functions (MiMo not reached). */
async function invokeAudioFunctionWithTransientRetry<T>(
  request: () => Promise<{ data: T | null; error: unknown }>,
  signal: AbortSignal | undefined,
  maxAttempts: number
): Promise<{ data: T | null; error: unknown }> {
  let result = await request();
  for (let attempt = 1; attempt < maxAttempts && result.error && isTransientAudioFunctionError(result.error); attempt += 1) {
    if (signal?.aborted) return result;
    // Longer backoff: mobile networks often need a few seconds after a dropped socket.
    await delay(800 * attempt + Math.floor(Math.random() * 400));
    if (signal?.aborted) return result;
    result = await request();
  }
  return result;
}

function isTransientAudioFunctionError(error: unknown): boolean {
  // If we have an HTTP Response body, the Edge Function (or gateway) answered — do not blind-retry
  // non-idempotent work unless status is clearly gateway/transient.
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    return context.status === 408 || context.status === 429 || context.status === 502 || context.status === 503 || context.status === 504;
  }
  const name = String((error as { name?: unknown })?.name ?? "").toLowerCase();
  const message = String((error as { message?: unknown })?.message ?? error).toLowerCase();
  return name.includes("fetch")
    || message.includes("failed to send a request")
    || message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("load failed")
    || message.includes("err_network")
    || message.includes("timeout")
    || message.includes("超时");
}
