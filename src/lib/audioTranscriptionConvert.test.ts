import { describe, expect, it } from "vitest";
import { encodeMonoWav } from "./audioTranscription";

describe("音频格式转换（浏览器内）", () => {
  it("单声道 PCM 编码为 WAV 且体积约为采样数×2 字节", () => {
    const sampleRate = 16_000;
    const samples = new Float32Array(sampleRate);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
    }
    const wav = encodeMonoWav(samples, sampleRate);
    expect(wav.type).toBe("audio/wav");
    // 44-byte header + 2 bytes per sample
    expect(wav.size).toBe(44 + samples.length * 2);
  });

  it("16 kHz 单声道一小时约 115MB，远小于 44.1k 立体声满采样 WAV", () => {
    const hourMono16k = 3_600 * 16_000 * 2 + 44;
    const hourStereo44k = 3_600 * 44_100 * 2 * 2 + 44;
    expect(hourMono16k).toBeLessThan(120 * 1024 * 1024);
    expect(hourMono16k).toBeLessThan(hourStereo44k / 5);
  });
});
