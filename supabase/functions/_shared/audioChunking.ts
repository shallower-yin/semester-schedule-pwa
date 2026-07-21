export interface AudioChunk {
  bytes: Uint8Array;
  mimeType: string;
  durationMs?: number;
}

// 7,000,000 raw bytes become about 9.33 MB after Base64, leaving room in MiMo's 10 MB JSON request body.
export const MAX_ASR_AUDIO_CHUNK_BYTES = 7_000_000;
export const MAX_ASR_AUDIO_CHUNK_DURATION_MS = 6 * 60 * 1000;
export const MP3_RANGE_OVERLAP_BYTES = 4_096;

export function splitAudioForAsr(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  maxBytes = MAX_ASR_AUDIO_CHUNK_BYTES
): AudioChunk[] {
  if (bytes.length <= maxBytes) return [{ bytes, mimeType: normalizeAudioMime(mimeType, fileName) }];
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "mp3" || mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return splitMp3(bytes, maxBytes).map((chunk) => ({ ...chunk, mimeType: "audio/mpeg" }));
  }
  if (extension === "wav" || mimeType.includes("wav")) {
    return splitWav(bytes, maxBytes).map((chunk) => ({ ...chunk, mimeType: "audio/wav" }));
  }
  if (extension === "m4a" || extension === "mp4" || mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) {
    return splitM4aOrAac(bytes, maxBytes).map((chunk) => ({ ...chunk, mimeType: "audio/aac" }));
  }
  throw new Error("超过 7 MB 的音频目前支持 MP3、WAV、M4A 自动分段；FLAC/OGG 请先转换为 MP3/M4A 后重试。");
}

function normalizeAudioMime(mimeType: string, fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "m4a" || extension === "mp4") return mimeType.includes("aac") ? "audio/aac" : (mimeType || "audio/mp4");
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  return mimeType || "application/octet-stream";
}

export function extractMp3RangeForAsr(
  bytes: Uint8Array,
  absoluteOffset: number,
  nominalStart: number,
  nominalEnd: number
): AudioChunk {
  let offset = absoluteOffset === 0 ? id3v2End(bytes) : 0;
  const frames: Array<{ start: number; end: number; durationMs: number }> = [];
  let durationMs = 0;
  while (offset + 4 <= bytes.length) {
    const frame = mp3FrameInfo(bytes, offset);
    if (!frame || offset + frame.length > bytes.length) {
      offset += 1;
      continue;
    }
    const globalStart = absoluteOffset + offset;
    if (globalStart >= nominalStart && globalStart <= nominalEnd) {
      frames.push({ start: offset, end: offset + frame.length, durationMs: frame.durationMs });
      durationMs += frame.durationMs;
    }
    offset += frame.length;
  }
  if (!frames.length) throw new Error("无法从 MP3 分段中识别有效音频帧，请转换为标准 MP3 后重试。");
  const total = frames.reduce((sum, frame) => sum + frame.end - frame.start, 0);
  return { bytes: copyFrames(bytes, frames, total), mimeType: "audio/mpeg", durationMs };
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

/**
 * Large M4A/AAC support:
 * 1) Raw ADTS AAC streams are split on frame boundaries (same idea as MP3).
 * 2) Typical phone M4A (AAC in MP4) is demuxed via stsz/stco sample tables and remuxed to ADTS.
 * ASR providers accept audio/aac ADTS chunks more reliably than raw mdat slices.
 */
function splitM4aOrAac(bytes: Uint8Array, maxBytes: number): Array<{ bytes: Uint8Array; durationMs: number }> {
  const adtsFrames = collectAdtsFrames(bytes);
  if (adtsFrames.length && adtsFrames.reduce((sum, frame) => sum + frame.end - frame.start, 0) >= bytes.length * 0.8) {
    return groupSizedFrames(bytes, adtsFrames, maxBytes, (frame) => frame.durationMs);
  }
  const remuxed = remuxMp4AacToAdtsFrames(bytes);
  if (!remuxed.frames.length) {
    throw new Error("无法解析该 M4A/AAC 文件的音频样本，请转换为标准 MP3 或 M4A 后重试。");
  }
  return groupAdtsPayloads(remuxed.frames, maxBytes);
}

function collectAdtsFrames(bytes: Uint8Array): Array<{ start: number; end: number; durationMs: number }> {
  const frames: Array<{ start: number; end: number; durationMs: number }> = [];
  let offset = 0;
  while (offset + 7 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf0) !== 0xf0) {
      offset += 1;
      continue;
    }
    const frameLength = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | ((bytes[offset + 5] & 0xe0) >> 5);
    if (frameLength < 7 || offset + frameLength > bytes.length) {
      offset += 1;
      continue;
    }
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x0f;
    const sampleRate = AAC_SAMPLE_RATES[sampleRateIndex] ?? 44_100;
    frames.push({ start: offset, end: offset + frameLength, durationMs: (1024 / sampleRate) * 1000 });
    offset += frameLength;
  }
  return frames;
}

function groupSizedFrames(
  bytes: Uint8Array,
  frames: Array<{ start: number; end: number; durationMs: number }>,
  maxBytes: number,
  durationOf: (frame: { start: number; end: number; durationMs: number }) => number
): Array<{ bytes: Uint8Array; durationMs: number }> {
  const chunks: Array<{ bytes: Uint8Array; durationMs: number }> = [];
  let group: Array<{ start: number; end: number; durationMs: number }> = [];
  let groupSize = 0;
  let groupDurationMs = 0;
  for (const frame of frames) {
    const frameSize = frame.end - frame.start;
    const frameDuration = durationOf(frame);
    if (group.length && (groupSize + frameSize > maxBytes || groupDurationMs + frameDuration > MAX_ASR_AUDIO_CHUNK_DURATION_MS)) {
      chunks.push({ bytes: copyFrames(bytes, group, groupSize), durationMs: groupDurationMs });
      group = [];
      groupSize = 0;
      groupDurationMs = 0;
    }
    group.push(frame);
    groupSize += frameSize;
    groupDurationMs += frameDuration;
  }
  if (group.length) chunks.push({ bytes: copyFrames(bytes, group, groupSize), durationMs: groupDurationMs });
  return chunks;
}

function groupAdtsPayloads(
  frames: Array<{ bytes: Uint8Array; durationMs: number }>,
  maxBytes: number
): Array<{ bytes: Uint8Array; durationMs: number }> {
  const chunks: Array<{ bytes: Uint8Array; durationMs: number }> = [];
  let group: Uint8Array[] = [];
  let groupSize = 0;
  let groupDurationMs = 0;
  for (const frame of frames) {
    if (group.length && (groupSize + frame.bytes.length > maxBytes || groupDurationMs + frame.durationMs > MAX_ASR_AUDIO_CHUNK_DURATION_MS)) {
      chunks.push({ bytes: concatBytes(group, groupSize), durationMs: groupDurationMs });
      group = [];
      groupSize = 0;
      groupDurationMs = 0;
    }
    group.push(frame.bytes);
    groupSize += frame.bytes.length;
    groupDurationMs += frame.durationMs;
  }
  if (group.length) chunks.push({ bytes: concatBytes(group, groupSize), durationMs: groupDurationMs });
  return chunks;
}

function concatBytes(parts: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

interface Mp4AacConfig {
  audioObjectType: number;
  sampleRateIndex: number;
  channelConfig: number;
  sampleRate: number;
}

function remuxMp4AacToAdtsFrames(bytes: Uint8Array): { frames: Array<{ bytes: Uint8Array; durationMs: number }> } {
  const boxes = readTopLevelBoxes(bytes);
  const moov = boxes.find((box) => box.type === "moov");
  const mdatBoxes = boxes.filter((box) => box.type === "mdat");
  if (!moov || !mdatBoxes.length) return { frames: [] };

  const moovBytes = bytes.subarray(moov.start, moov.end);
  const tracks = findBoxes(moovBytes, 0, moovBytes.length, "trak");
  for (const track of tracks) {
    const trackBytes = moovBytes.subarray(track.start, track.end);
    const stsd = findFirstNested(trackBytes, "stsd");
    if (!stsd) continue;
    const config = parseMp4aConfig(trackBytes.subarray(stsd.start, stsd.end));
    if (!config) continue;
    const stsz = findFirstNested(trackBytes, "stsz");
    const stco = findFirstNested(trackBytes, "stco") ?? findFirstNested(trackBytes, "co64");
    const stsc = findFirstNested(trackBytes, "stsc");
    const stts = findFirstNested(trackBytes, "stts");
    if (!stsz || !stco || !stsc) continue;

    const sampleSizes = parseStsz(trackBytes.subarray(stsz.start, stsz.end));
    const chunkOffsets = parseChunkOffsets(trackBytes.subarray(stco.start, stco.end), stco.type === "co64");
    const samplesPerChunk = parseStsc(trackBytes.subarray(stsc.start, stsc.end), sampleSizes.length);
    const sampleDurations = stts
      ? parseStts(trackBytes.subarray(stts.start, stts.end), sampleSizes.length)
      : sampleSizes.map(() => 1024);
    if (!sampleSizes.length || !chunkOffsets.length || !samplesPerChunk.length) continue;

    const sampleOffsets = expandSampleOffsets(chunkOffsets, samplesPerChunk, sampleSizes);
    const frames: Array<{ bytes: Uint8Array; durationMs: number }> = [];
    for (let index = 0; index < sampleSizes.length; index += 1) {
      const start = sampleOffsets[index];
      const size = sampleSizes[index];
      if (start < 0 || size <= 0 || start + size > bytes.length) continue;
      const aac = bytes.subarray(start, start + size);
      const adts = wrapAacInAdts(aac, config);
      const durationMs = (sampleDurations[index] / config.sampleRate) * 1000;
      frames.push({ bytes: adts, durationMs });
    }
    if (frames.length) return { frames };
  }
  return { frames: [] };
}

function readTopLevelBoxes(bytes: Uint8Array): Array<{ type: string; start: number; end: number }> {
  const boxes: Array<{ type: string; start: number; end: number }> = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = readU32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1 && offset + 16 <= bytes.length) {
      size = Number((BigInt(readU32BE(bytes, offset + 8)) << 32n) + BigInt(readU32BE(bytes, offset + 12)));
      header = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < header || offset + size > bytes.length) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findBoxes(bytes: Uint8Array, start: number, end: number, type: string): Array<{ type: string; start: number; end: number }> {
  const found: Array<{ type: string; start: number; end: number }> = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = readU32BE(bytes, offset);
    const boxType = ascii(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      size = Number((BigInt(readU32BE(bytes, offset + 8)) << 32n) + BigInt(readU32BE(bytes, offset + 12)));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    const contentStart = offset + header;
    const contentEnd = offset + size;
    if (boxType === type) found.push({ type: boxType, start: contentStart, end: contentEnd });
    if (["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"].includes(boxType)) {
      found.push(...findBoxes(bytes, contentStart, contentEnd, type));
    }
    offset += size;
  }
  return found;
}

function findFirstNested(bytes: Uint8Array, type: string): { type: string; start: number; end: number } | null {
  return findBoxes(bytes, 0, bytes.length, type)[0] ?? null;
}

function parseMp4aConfig(stsdBytes: Uint8Array): Mp4AacConfig | null {
  // stsd: version/flags(4) + entry_count(4) + sample entries
  if (stsdBytes.length < 16) return null;
  let offset = 8;
  while (offset + 8 <= stsdBytes.length) {
    const size = readU32BE(stsdBytes, offset);
    const type = ascii(stsdBytes, offset + 4, 4);
    if (size < 8 || offset + size > stsdBytes.length) break;
    if (type === "mp4a" || type === "enca") {
      // sample entry header 8 + 6 reserved + data ref + 20 sound description fields = 36 after box header → esds often after that
      const entry = stsdBytes.subarray(offset + 8, offset + size);
      const esds = findEsdsDecoderConfig(entry);
      if (esds) return esds;
    }
    offset += size;
  }
  // Fallback: scan for AudioSpecificConfig-looking esds payload anywhere in stsd
  return findEsdsDecoderConfig(stsdBytes);
}

function findEsdsDecoderConfig(bytes: Uint8Array): Mp4AacConfig | null {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (ascii(bytes, offset, 4) !== "esds") continue;
    const size = offset >= 4 ? readU32BE(bytes, offset - 4) : 0;
    const end = size > 8 && offset - 4 + size <= bytes.length ? offset - 4 + size : Math.min(bytes.length, offset + 64);
    const payload = bytes.subarray(offset + 4, end);
    const config = parseEsdsAudioSpecificConfig(payload);
    if (config) return config;
  }
  // Some writers embed raw AudioSpecificConfig without a clean esds tag walk — scan for plausible 2-byte ASC.
  for (let offset = 0; offset + 2 <= bytes.length; offset += 1) {
    const aot = (bytes[offset] >> 3) & 0x1f;
    const sampleRateIndex = ((bytes[offset] & 0x07) << 1) | ((bytes[offset + 1] >> 7) & 0x01);
    const channelConfig = (bytes[offset + 1] >> 3) & 0x0f;
    if (aot >= 1 && aot <= 4 && sampleRateIndex <= 12 && channelConfig >= 1 && channelConfig <= 7) {
      return {
        audioObjectType: aot,
        sampleRateIndex,
        channelConfig,
        sampleRate: AAC_SAMPLE_RATES[sampleRateIndex] ?? 44_100
      };
    }
  }
  return null;
}

function parseEsdsAudioSpecificConfig(bytes: Uint8Array): Mp4AacConfig | null {
  // Walk ISO 14496-1 expandable descriptors looking for DecoderSpecificInfo (tag 0x05).
  let offset = 0;
  // skip version/flags if present
  if (bytes.length > 4 && bytes[0] === 0x00) offset = 4;
  while (offset < bytes.length) {
    const tag = bytes[offset];
    offset += 1;
    let size = 0;
    for (let i = 0; i < 4 && offset < bytes.length; i += 1) {
      const value = bytes[offset];
      offset += 1;
      size = (size << 7) | (value & 0x7f);
      if ((value & 0x80) === 0) break;
    }
    if (offset + size > bytes.length) break;
    if (tag === 0x05 && size >= 2) {
      const aot = (bytes[offset] >> 3) & 0x1f;
      const sampleRateIndex = ((bytes[offset] & 0x07) << 1) | ((bytes[offset + 1] >> 7) & 0x01);
      const channelConfig = (bytes[offset + 1] >> 3) & 0x0f;
      if (aot === 31 || sampleRateIndex === 15) return null;
      return {
        audioObjectType: aot || 2,
        sampleRateIndex,
        channelConfig: channelConfig || 1,
        sampleRate: AAC_SAMPLE_RATES[sampleRateIndex] ?? 44_100
      };
    }
    // Dive into ES_Descriptor / DecoderConfigDescriptor containers
    if (tag === 0x03 || tag === 0x04) {
      const nested = parseEsdsAudioSpecificConfig(bytes.subarray(offset, offset + size));
      if (nested) return nested;
    }
    offset += size;
  }
  return null;
}

function parseStsz(box: Uint8Array): number[] {
  if (box.length < 12) return [];
  const sampleSize = readU32BE(box, 4);
  const sampleCount = readU32BE(box, 8);
  if (sampleSize > 0) return Array.from({ length: sampleCount }, () => sampleSize);
  const sizes: number[] = [];
  let offset = 12;
  for (let index = 0; index < sampleCount && offset + 4 <= box.length; index += 1) {
    sizes.push(readU32BE(box, offset));
    offset += 4;
  }
  return sizes;
}

function parseChunkOffsets(box: Uint8Array, is64: boolean): number[] {
  if (box.length < 8) return [];
  const count = readU32BE(box, 4);
  const offsets: number[] = [];
  let offset = 8;
  const width = is64 ? 8 : 4;
  for (let index = 0; index < count && offset + width <= box.length; index += 1) {
    if (is64) {
      offsets.push(Number((BigInt(readU32BE(box, offset)) << 32n) + BigInt(readU32BE(box, offset + 4))));
    } else {
      offsets.push(readU32BE(box, offset));
    }
    offset += width;
  }
  return offsets;
}

/** Returns samples-per-chunk for each chunk until totalSamples are covered. */
function parseStsc(box: Uint8Array, totalSamples: number): number[] {
  if (box.length < 8) return [];
  const entryCount = readU32BE(box, 4);
  const entries: Array<{ firstChunk: number; samplesPerChunk: number }> = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 12 <= box.length; index += 1) {
    entries.push({ firstChunk: readU32BE(box, offset), samplesPerChunk: readU32BE(box, offset + 4) });
    offset += 12;
  }
  if (!entries.length) return [];
  const perChunk: number[] = [];
  let entryIndex = 0;
  let chunk = 1;
  let remaining = totalSamples;
  while (remaining > 0) {
    while (entryIndex + 1 < entries.length && chunk >= entries[entryIndex + 1].firstChunk) entryIndex += 1;
    const count = entries[entryIndex]?.samplesPerChunk ?? 0;
    if (count <= 0) break;
    const take = Math.min(remaining, count);
    perChunk.push(take);
    remaining -= take;
    chunk += 1;
    if (chunk > totalSamples + entries.length + 8) break;
  }
  return perChunk;
}

function parseStts(box: Uint8Array, totalSamples: number): number[] {
  if (box.length < 8) return sampleArray(totalSamples, 1024);
  const entryCount = readU32BE(box, 4);
  const durations: number[] = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= box.length; index += 1) {
    const sampleCount = readU32BE(box, offset);
    const sampleDelta = readU32BE(box, offset + 4);
    offset += 8;
    for (let sample = 0; sample < sampleCount && durations.length < totalSamples; sample += 1) {
      durations.push(sampleDelta || 1024);
    }
  }
  while (durations.length < totalSamples) durations.push(1024);
  return durations;
}

function sampleArray(count: number, value: number): number[] {
  return Array.from({ length: count }, () => value);
}

function expandSampleOffsets(chunkOffsets: number[], samplesPerChunk: number[], sampleSizes: number[]): number[] {
  const offsets: number[] = [];
  let sampleIndex = 0;
  for (let chunkIndex = 0; chunkIndex < chunkOffsets.length && sampleIndex < sampleSizes.length; chunkIndex += 1) {
    let cursor = chunkOffsets[chunkIndex];
    const count = samplesPerChunk[chunkIndex] ?? 0;
    for (let sample = 0; sample < count && sampleIndex < sampleSizes.length; sample += 1) {
      offsets.push(cursor);
      cursor += sampleSizes[sampleIndex];
      sampleIndex += 1;
    }
  }
  return offsets;
}

function wrapAacInAdts(aac: Uint8Array, config: Mp4AacConfig): Uint8Array {
  const frameLength = 7 + aac.length;
  const header = new Uint8Array(7);
  header[0] = 0xff;
  header[1] = 0xf1; // MPEG-4, layer 0, protection absent
  header[2] = (((config.audioObjectType - 1) & 0x03) << 6)
    | ((config.sampleRateIndex & 0x0f) << 2)
    | ((config.channelConfig >> 2) & 0x01);
  header[3] = ((config.channelConfig & 0x03) << 6) | ((frameLength >> 11) & 0x03);
  header[4] = (frameLength >> 3) & 0xff;
  header[5] = ((frameLength & 0x07) << 5) | 0x1f;
  header[6] = 0xfc;
  const out = new Uint8Array(frameLength);
  out.set(header, 0);
  out.set(aac, 7);
  return out;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
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
