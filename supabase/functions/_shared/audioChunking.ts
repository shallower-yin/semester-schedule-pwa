export interface AudioChunk {
  bytes: Uint8Array;
  mimeType: string;
  durationMs?: number;
}

// 7,000,000 raw bytes become about 9.33 MB after Base64, leaving room in MiMo's 10 MB JSON request body.
export const MAX_ASR_AUDIO_CHUNK_BYTES = 7_000_000;
export const MAX_ASR_AUDIO_CHUNK_DURATION_MS = 6 * 60 * 1000;

export function splitAudioForAsr(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  maxBytes = MAX_ASR_AUDIO_CHUNK_BYTES
): AudioChunk[] {
  if (bytes.length <= maxBytes) return [{ bytes, mimeType }];
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "mp3") return splitMp3(bytes, maxBytes).map((chunk) => ({ ...chunk, mimeType: "audio/mpeg" }));
  if (extension === "wav") return splitWav(bytes, maxBytes).map((chunk) => ({ ...chunk, mimeType: "audio/wav" }));
  throw new Error("超过 7 MB 的音频目前仅支持 MP3、WAV 自动分段，请先转换格式后重试。");
}

function splitMp3(bytes: Uint8Array, maxBytes: number): Array<{ bytes: Uint8Array; durationMs: number }> {
  let offset = id3v2End(bytes);
  const frames: Array<{ start: number; end: number; durationMs: number }> = [];
  while (offset + 4 <= bytes.length) {
    const frame = mp3FrameInfo(bytes, offset);
    if (!frame || offset + frame.length > bytes.length) {
      offset += 1;
      continue;
    }
    frames.push({ start: offset, end: offset + frame.length, durationMs: frame.durationMs });
    offset += frame.length;
  }
  const framedBytes = frames.reduce((total, frame) => total + frame.end - frame.start, 0);
  if (!frames.length || framedBytes < bytes.length * 0.7) {
    throw new Error("无法识别该 MP3 的音频帧，请转换为标准 MP3 或 WAV 后重试。");
  }

  const chunks: Array<{ bytes: Uint8Array; durationMs: number }> = [];
  let group: Array<{ start: number; end: number; durationMs: number }> = [];
  let groupSize = 0;
  let groupDurationMs = 0;
  for (const frame of frames) {
    const frameSize = frame.end - frame.start;
    if (group.length && (groupSize + frameSize > maxBytes || groupDurationMs + frame.durationMs > MAX_ASR_AUDIO_CHUNK_DURATION_MS)) {
      chunks.push({ bytes: copyFrames(bytes, group, groupSize), durationMs: groupDurationMs });
      group = [];
      groupSize = 0;
      groupDurationMs = 0;
    }
    group.push(frame);
    groupSize += frameSize;
    groupDurationMs += frame.durationMs;
  }
  if (group.length) chunks.push({ bytes: copyFrames(bytes, group, groupSize), durationMs: groupDurationMs });
  return chunks;
}

function id3v2End(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return Math.min(bytes.length, 10 + size + ((bytes[5] & 0x10) ? 10 : 0));
}

function mp3FrameInfo(bytes: Uint8Array, offset: number): { length: number; durationMs: number } | null {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  if (first !== 0xff || (second & 0xe0) !== 0xe0) return null;
  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const bitrate = mp3Bitrate(version, layer, bitrateIndex);
  const baseRate = [44100, 48000, 32000][sampleRateIndex];
  const sampleRate = version === 1 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
  const padding = (third >> 1) & 1;
  if (!bitrate || !sampleRate) return null;
  const length = layer === 1
    ? Math.floor(((12 * bitrate * 1000) / sampleRate + padding) * 4)
    : layer === 3 && version !== 1
      ? Math.floor((72 * bitrate * 1000) / sampleRate + padding)
      : Math.floor((144 * bitrate * 1000) / sampleRate + padding);
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  return { length, durationMs: (samples / sampleRate) * 1000 };
}

function mp3Bitrate(version: number, layer: number, index: number): number {
  const mpeg1: Record<number, number[]> = {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  };
  const mpeg2: Record<number, number[]> = {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  };
  return (version === 1 ? mpeg1 : mpeg2)[layer]?.[index] ?? 0;
}

function copyFrames(bytes: Uint8Array, frames: Array<{ start: number; end: number }>, total: number): Uint8Array {
  const contiguous = frames.every((frame, index) => index === 0 || frames[index - 1].end === frame.start);
  if (contiguous) return bytes.subarray(frames[0].start, frames[frames.length - 1].end);

  const result = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    const value = bytes.subarray(frame.start, frame.end);
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function splitWav(bytes: Uint8Array, maxBytes: number): Array<{ bytes: Uint8Array; durationMs: number }> {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") throw new Error("WAV 文件头无效，请重新导出后重试。");
  let offset = 12;
  let dataOffset = -1;
  let dataSizeOffset = -1;
  let dataSize = 0;
  let blockAlign = 1;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    if (id === "fmt " && size >= 16 && offset + 8 + size <= bytes.length) {
      byteRate = readU32(bytes, offset + 8 + 8);
      blockAlign = Math.max(1, readU16(bytes, offset + 8 + 12));
    }
    if (id === "data") {
      dataSizeOffset = offset + 4;
      dataOffset = offset + 8;
      dataSize = Math.min(size, bytes.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || dataSizeOffset < 0 || dataSize <= 0) throw new Error("WAV 文件中没有可识别的音频数据。");
  const header = bytes.slice(0, dataOffset);
  const maxBytePayload = Math.max(blockAlign, Math.floor((maxBytes - header.length) / blockAlign) * blockAlign);
  const maxDurationPayload = byteRate > 0
    ? Math.max(blockAlign, Math.floor((byteRate * MAX_ASR_AUDIO_CHUNK_DURATION_MS / 1000) / blockAlign) * blockAlign)
    : maxBytePayload;
  const maxPayload = Math.min(maxBytePayload, maxDurationPayload);
  const chunks: Array<{ bytes: Uint8Array; durationMs: number }> = [];
  for (let start = 0; start < dataSize; start += maxPayload) {
    const payloadSize = Math.min(maxPayload, dataSize - start);
    const alignedSize = start + payloadSize < dataSize ? Math.floor(payloadSize / blockAlign) * blockAlign : payloadSize;
    const chunk = new Uint8Array(header.length + alignedSize);
    chunk.set(header);
    chunk.set(bytes.subarray(dataOffset + start, dataOffset + start + alignedSize), header.length);
    writeU32(chunk, 4, chunk.length - 8);
    writeU32(chunk, dataSizeOffset, alignedSize);
    chunks.push({ bytes: chunk, durationMs: byteRate > 0 ? alignedSize / byteRate * 1000 : 0 });
  }
  return chunks;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
