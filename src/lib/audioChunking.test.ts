import { describe, expect, it } from "vitest";
import { extractMp3RangeForAsr, splitAudioForAsr } from "../../supabase/functions/_shared/audioChunking";

describe("audio chunking", () => {
  it("keeps small files intact", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const chunks = splitAudioForAsr(bytes, "small.mp3", "audio/mpeg", 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].bytes).toBe(bytes);
  });

  it("splits MP3 on frame boundaries", () => {
    const frameLength = 417;
    const bytes = new Uint8Array(frameLength * 8);
    for (let offset = 0; offset < bytes.length; offset += frameLength) {
      bytes.set([0xff, 0xfb, 0x90, 0x00], offset);
    }
    const chunks = splitAudioForAsr(bytes, "meeting.mp3", "audio/mpeg", frameLength * 3 + 10);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.bytes[0] === 0xff && chunk.bytes[1] === 0xfb)).toBe(true);
    expect(chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0)).toBe(bytes.length);
  });

  it("keeps long MP3 chunks within six minutes", () => {
    const frameLength = 417;
    const frameCount = 15_000;
    const bytes = new Uint8Array(frameLength * frameCount);
    for (let offset = 0; offset < bytes.length; offset += frameLength) {
      bytes.set([0xff, 0xfb, 0x90, 0x00], offset);
    }
    const chunks = splitAudioForAsr(bytes, "long-meeting.mp3", "audio/mpeg", 6_000_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => (chunk.durationMs ?? 0) <= 360_050)).toBe(true);
  });

  it("assigns overlapping R2 ranges without duplicating MP3 frames", () => {
    const frameLength = 417;
    const bytes = new Uint8Array(frameLength * 20);
    for (let offset = 0; offset < bytes.length; offset += frameLength) {
      bytes.set([0xff, 0xfb, 0x90, 0x00], offset);
    }
    const boundary = 3_000;
    const first = extractMp3RangeForAsr(bytes, 0, 0, boundary - 1);
    const second = extractMp3RangeForAsr(bytes, 0, boundary, bytes.length - 1);
    expect(first.bytes.length + second.bytes.length).toBe(bytes.length);
  });

  it("creates independently valid WAV chunks", () => {
    const bytes = createWav(8_000);
    const chunks = splitAudioForAsr(bytes, "meeting.wav", "audio/wav", 2_100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(new TextDecoder().decode(chunk.bytes.subarray(0, 4))).toBe("RIFF");
      expect(readU32(chunk.bytes, 4)).toBe(chunk.bytes.length - 8);
      expect(readU32(chunk.bytes, 40)).toBe(chunk.bytes.length - 44);
    }
  });

  it("keeps small M4A intact without requiring conversion", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const chunks = splitAudioForAsr(bytes, "note.m4a", "audio/mp4", 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].bytes).toBe(bytes);
  });

  it("splits raw ADTS AAC / M4A streams on frame boundaries", () => {
    const frame = createAdtsFrame(200);
    const bytes = new Uint8Array(frame.length * 6);
    for (let index = 0; index < 6; index += 1) bytes.set(frame, index * frame.length);
    const chunks = splitAudioForAsr(bytes, "lecture.m4a", "audio/mp4", frame.length * 2 + 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.mimeType === "audio/aac")).toBe(true);
    expect(chunks.every((chunk) => chunk.bytes[0] === 0xff && (chunk.bytes[1] & 0xf0) === 0xf0)).toBe(true);
  });

  it("rejects large formats that cannot be safely split", () => {
    expect(() => splitAudioForAsr(new Uint8Array(20), "meeting.flac", "audio/flac", 10)).toThrow(/MP3、WAV、M4A|FLAC/);
  });
});

function createAdtsFrame(aacPayloadSize: number): Uint8Array {
  const frameLength = 7 + aacPayloadSize;
  const bytes = new Uint8Array(frameLength);
  bytes[0] = 0xff;
  bytes[1] = 0xf1;
  bytes[2] = 0x50; // AAC LC, 44.1kHz-ish
  bytes[3] = 0x80 | ((frameLength >> 11) & 0x03);
  bytes[4] = (frameLength >> 3) & 0xff;
  bytes[5] = ((frameLength & 0x07) << 5) | 0x1f;
  bytes[6] = 0xfc;
  return bytes;
}

function createWav(payloadSize: number): Uint8Array {
  const bytes = new Uint8Array(44 + payloadSize);
  writeAscii(bytes, 0, "RIFF");
  writeU32(bytes, 4, bytes.length - 8);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  writeU32(bytes, 16, 16);
  bytes[20] = 1;
  bytes[22] = 1;
  writeU32(bytes, 24, 16_000);
  writeU32(bytes, 28, 32_000);
  bytes[32] = 2;
  bytes[34] = 16;
  writeAscii(bytes, 36, "data");
  writeU32(bytes, 40, payloadSize);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
