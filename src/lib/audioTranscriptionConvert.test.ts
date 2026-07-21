import { describe, expect, it } from "vitest";
import {
  encodeMonoWav,
  maxSpeechWavPartSeconds,
  SPEECH_ASR_SAMPLE_RATE,
  SPEECH_WAV_PART_TARGET_BYTES
} from "./audioTranscription";

describe("音频格式转换（浏览器内）", () => {
  it("单声道 PCM 编码为 WAV 且体积约为采样数×2 字节", () => {
    const sampleRate = 16_000;
    const samples = new Float32Array(sampleRate);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
    }
    const wav = encodeMonoWav(samples, sampleRate);
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + samples.length * 2);
  });

  it("16 kHz 语音分段目标保证单段远低于 100MB", () => {
    const seconds = maxSpeechWavPartSeconds(SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES);
    const bytes = seconds * SPEECH_ASR_SAMPLE_RATE * 2 + 44;
    expect(seconds).toBeGreaterThan(10 * 60);
    expect(bytes).toBeLessThanOrEqual(SPEECH_WAV_PART_TARGET_BYTES + SPEECH_ASR_SAMPLE_RATE * 2);
    expect(bytes).toBeLessThan(100 * 1024 * 1024);
  });
});
