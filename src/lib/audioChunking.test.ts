import { describe, expect, it } from "vitest";
import { splitAudioForAsr } from "../../supabase/functions/_shared/audioChunking";

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

  it("rejects large formats that cannot be safely split", () => {
    expect(() => splitAudioForAsr(new Uint8Array(20), "meeting.m4a", "audio/mp4", 10)).toThrow("仅支持 MP3、WAV 自动分段");
  });
});

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
