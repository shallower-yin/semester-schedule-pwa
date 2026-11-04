import { splitAudioForAsr } from "../../supabase/functions/_shared/audioChunking";

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

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
export async function prepareFilesForAsr(
  files: File[],
  onProgress?: (completed: number, total: number, step: string) => void
): Promise<PreparedAudioPart[]> {
  const prepared: PreparedAudioPart[] = [];
  const multiSource = files.length > 1;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    // Large M4A is first demuxed on AAC sample boundaries, then each short AAC segment is decoded
    // independently to 16 kHz mono WAV. MiMo rejects raw AAC, while decoding the full 70-minute
    // recording at once would allocate multiple gigabytes in Android WebView.
    if (extension === "m4a" && file.size > 7_000_000) {
      onProgress?.(0, 1, `正在按音频时间解析 ${file.name}…`);
      const parts = await splitM4aFileForAsr(file, onProgress);
      const sourcePrefix = multiSource ? `文件${fileIndex + 1}/${files.length} · ` : "";
      for (const part of parts) {
        prepared.push({ file: part.file, orderLabel: `${sourcePrefix}${part.orderLabel}` });
      }
      continue;
    }
    // Other medium containers use browser decode → 16k mono WAV parts. Very large MP3 keeps the
    // progressive frame-range path so the client never expands it into raw PCM.
    // Large MP3 used to rely on progressive byte-ranges; real-world VBR files often yield 0/N.
    // Try conversion first for mp3 as well when not huge enough to risk phone OOM (~25 min cap).
    const convertExtensions = ["ogg", "flac", "mp3"];
    const needsConversion = file.size > 7_000_000 && convertExtensions.includes(extension);
    // Rough safety: ~25 min mono 48k float ≈ 280MB RAM; skip forced convert for very large mp3.
    const mp3TooLargeForBrowserConvert = extension === "mp3" && file.size > 35 * 1024 * 1024;
    if (!needsConversion || mp3TooLargeForBrowserConvert) {
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
      // MP3 progressive path remains available when decode/convert fails.
      if (extension === "mp3") {
        const prefix = multiSource ? `文件${fileIndex + 1}/${files.length} · ` : "";
        prepared.push({ file, orderLabel: `${prefix}${file.name}` });
        continue;
      }
      const reason = error instanceof Error ? error.message : "转换失败";
      throw new Error(`“${file.name}”无法自动转换为可转写格式（${reason}）。请先导出为标准 MP3 后重试。`);
    }
  }
  return prepared;
}

/** Low-memory M4A path: MP4 samples → short ADTS AAC → 16 kHz mono WAV, in exact time order. */
export async function splitM4aFileForAsr(
  file: File,
  onProgress?: (completed: number, total: number, step: string) => void
): Promise<ConvertedSpeechPart[]> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = splitAudioForAsr(bytes, file.name, file.type || "audio/mp4");
  // The demuxer returns independent frame buffers; release the original 67–100 MB container
  // before accumulating WAV blobs on memory-constrained Android WebViews.
  bytes = new Uint8Array(0);
  if (!chunks.length) throw new Error("没有解析到可转写的 AAC 音频段");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "audio";
  const width = Math.max(2, String(chunks.length).length);
  let elapsedMs = 0;
  const parts: ConvertedSpeechPart[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const durationMs = Math.max(1, Math.round(chunk.durationMs ?? 0));
    const startSec = elapsedMs / 1000;
    elapsedMs += durationMs;
    const endSec = elapsedMs / 1000;
    onProgress?.(index, chunks.length, `解码 M4A 分段 ${index + 1}/${chunks.length}…`);
    const prefix = `p${String(index).padStart(width, "0")}`;
    const aac = new File(
      [new Uint8Array(chunk.bytes).buffer],
      `${prefix}_${baseName}.aac`,
      { type: "audio/aac", lastModified: file.lastModified }
    );
    let converted: ConvertedSpeechPart[];
    try {
      converted = await convertAudioFileToSpeechParts(aac);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "AAC 解码失败";
      throw new Error(`M4A 第 ${index + 1}/${chunks.length} 段无法转换为 WAV（${reason}）`);
    }
    if (converted.length !== 1) {
      throw new Error(`M4A 第 ${index + 1}/${chunks.length} 段转换结果异常`);
    }
    const wav = converted[0].file;
    parts.push({
      file: new File([wav], `${prefix}_${baseName}.wav`, { type: "audio/wav", lastModified: file.lastModified }),
      orderLabel: `第 ${index + 1}/${chunks.length} 段 · 约 ${formatAudioClock(startSec)}–${formatAudioClock(endSec)}`,
      startSec,
      endSec,
      partIndex: index,
      partCount: chunks.length
    });
    chunks[index] = { ...chunk, bytes: new Uint8Array(0) };
    onProgress?.(index + 1, chunks.length, `已转换 M4A 分段 ${index + 1}/${chunks.length}`);
  }
  return parts;
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
export function mixToMonoSamples(buffer: AudioBuffer): { samples: Float32Array<ArrayBuffer>; sampleRate: number } {
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
  samples: Float32Array<ArrayBuffer>,
  srcRate: number,
  startSec: number,
  durationSec: number,
  targetRate: number
): Float32Array<ArrayBuffer> {
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

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
