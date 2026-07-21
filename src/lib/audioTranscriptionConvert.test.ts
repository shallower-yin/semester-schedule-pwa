import { describe, expect, it } from "vitest";
import {
  encodeMonoWav,
  formatAudioClock,
  joinSequentialTranscripts,
  maxSpeechWavPartSeconds,
  sliceAndResampleMono,
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

  it("16 kHz 语音分段目标保证单段低于 ASR 7MB 预算", () => {
    const seconds = maxSpeechWavPartSeconds(SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES);
    const bytes = seconds * SPEECH_ASR_SAMPLE_RATE * 2 + 44;
    expect(seconds).toBeGreaterThan(60);
    expect(bytes).toBeLessThanOrEqual(SPEECH_WAV_PART_TARGET_BYTES + SPEECH_ASR_SAMPLE_RATE * 2);
    expect(bytes).toBeLessThan(7 * 1024 * 1024);
  });

  it("拼接转写严格按数组顺序，失败段保留占位", () => {
    const text = joinSequentialTranscripts(
      ["第 1/3 段 · 约 0:00–3:00", "第 2/3 段 · 约 3:00–6:00", "第 3/3 段 · 约 6:00–9:00"],
      ["开场", null, "结尾"]
    );
    expect(text.indexOf("开场")).toBeLessThan(text.indexOf("本段转写失败"));
    expect(text.indexOf("本段转写失败")).toBeLessThan(text.indexOf("结尾"));
    expect(formatAudioClock(3945)).toBe("1:05:45");
    expect(formatAudioClock(125)).toBe("2:05");
  });

  it("按源采样帧时间切片，第 N 段只包含对应时间段的信号", () => {
    // 3 秒 @ 48 kHz：0–1s 填 0.25，1–2s 填 0.75，2–3s 填 -0.5
    const srcRate = 48_000;
    const samples = new Float32Array(srcRate * 3);
    samples.fill(0.25, 0, srcRate);
    samples.fill(0.75, srcRate, srcRate * 2);
    samples.fill(-0.5, srcRate * 2, srcRate * 3);

    const part0 = sliceAndResampleMono(samples, srcRate, 0, 1, 16_000);
    const part1 = sliceAndResampleMono(samples, srcRate, 1, 1, 16_000);
    const part2 = sliceAndResampleMono(samples, srcRate, 2, 1, 16_000);

    const mean = (data: Float32Array) => data.reduce((sum, value) => sum + value, 0) / data.length;
    expect(mean(part0)).toBeCloseTo(0.25, 2);
    expect(mean(part1)).toBeCloseTo(0.75, 2);
    expect(mean(part2)).toBeCloseTo(-0.5, 2);
    // 绝不能把第 1 秒的电平放到第 0 段（历史上 OfflineAudioContext offset 错切会出现）
    expect(Math.abs(mean(part0) - 0.75)).toBeGreaterThan(0.3);
  });
});
