import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertAudioFileToSpeechParts, encodeMonoWav, maxSpeechWavPartSeconds,
  mixToMonoSamples, prepareFilesForAsr, sliceAndResampleMono, splitM4aFileForAsr,
  SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES
} from "./audioPreparation";

const audio = vi.hoisted(() => ({ decode: vi.fn(), close: vi.fn(), split: vi.fn(), contexts: vi.fn() }));
vi.mock("../../supabase/functions/_shared/audioChunking", () => ({ splitAudioForAsr: audio.split }));
const BrowserFile = File;

function pcm(values = [0.25, 0.5, -0.25, -0.5], sampleRate = 4): AudioBuffer {
  const samples = Float32Array.from(values);
  return { length: samples.length, sampleRate, duration: samples.length / sampleRate,
    numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
}
function file(name: string, size = 12): File {
  const result = new File([new Uint8Array(12)], name, { type: "audio/mpeg", lastModified: 1234 });
  Object.defineProperty(result, "size", { value: size });
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom's File lacks arrayBuffer. Decoding is stubbed; these bytes never leave the test.
  vi.stubGlobal("File", class extends BrowserFile {
    async arrayBuffer() { return new ArrayBuffer(12); }
  });
  vi.stubGlobal("AudioContext", class {
    constructor() { audio.contexts(); }
    decodeAudioData = audio.decode;
    close = audio.close;
  });
  audio.decode.mockResolvedValue(pcm());
  audio.close.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("音频本地预处理边界", () => {
  it("小文件和超大MP3按输入顺序保留，不实例化解码器", async () => {
    const files = [file("first.mp3"), file("large.MP3", 36 * 1024 * 1024), file("last.wav")];
    const prepared = await prepareFilesForAsr(files);
    expect(prepared.map((part) => part.file)).toEqual(files);
    expect(prepared.map((part) => part.orderLabel)).toEqual([
      "文件1/3 · first.mp3", "文件2/3 · large.MP3", "文件3/3 · last.wav"
    ]);
    expect(audio.contexts).not.toHaveBeenCalled();
  });

  it("可转换格式与小文件混合仍保持源文件顺序", async () => {
    const files = [file("first.ogg", 8_000_000), file("middle.wav"), file("last.flac", 8_000_000)];
    const prepared = await prepareFilesForAsr(files);
    expect(prepared.map((part) => part.file.name)).toEqual(["p00_first.wav", "middle.wav", "p00_last.wav"]);
    expect(prepared.map((part) => part.orderLabel)).toEqual([
      "文件1/3 · first.ogg", "文件2/3 · middle.wav", "文件3/3 · last.flac"
    ]);
    expect(audio.decode).toHaveBeenCalledTimes(2);
    expect(audio.close).toHaveBeenCalledTimes(2);
  });

  it("中等MP3解码失败时保留原文件供range转写，关闭解码器", async () => {
    audio.decode.mockRejectedValue(new Error("unsupported codec"));
    const source = file("fallback.mp3", 8_000_000);
    expect(await prepareFilesForAsr([source])).toEqual([{ file: source, orderLabel: source.name }]);
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it.each(["ogg", "flac"])("%s解码失败保留有意义的错误，不错误套用MP3回退", async (extension) => {
    audio.decode.mockRejectedValue(new Error("unsupported codec"));
    audio.close.mockRejectedValue(new Error("close failed"));
    await expect(prepareFilesForAsr([file(`input.${extension}`, 8_000_000)]))
      .rejects.toThrow(`“input.${extension}”无法自动转换为可转写格式（unsupported codec）`);
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("分段时间和文件名前缀单调，最后一段仅包含余下采样", async () => {
    const partSeconds = maxSpeechWavPartSeconds(SPEECH_ASR_SAMPLE_RATE, SPEECH_WAV_PART_TARGET_BYTES);
    audio.decode.mockResolvedValue(pcm(Array((partSeconds + 2) * 4).fill(0.25), 4));
    const progress = vi.fn();
    const parts = await convertAudioFileToSpeechParts(file("lecture.ogg"), progress);
    expect(parts.map(({ startSec, endSec, partIndex, partCount }) => ({ startSec, endSec, partIndex, partCount })))
      .toEqual([
        { startSec: 0, endSec: partSeconds, partIndex: 0, partCount: 2 },
        { startSec: partSeconds, endSec: partSeconds + 2, partIndex: 1, partCount: 2 }
      ]);
    expect(parts.map((part) => part.file.name)).toEqual(["p00_lecture.wav", "p01_lecture.wav"]);
    expect(parts[0].file.size).toBeLessThan(7_000_000);
    expect(parts[1].file.size).toBe(44 + 2 * SPEECH_ASR_SAMPLE_RATE * 2);
    expect(progress).toHaveBeenLastCalledWith(2, 2, "转换分段 2/2…");
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("M4A按AAC分片逐段解码并保留时间顺序与修改时间", async () => {
    audio.split.mockReturnValue([
      { bytes: new Uint8Array([1]), durationMs: 1500 },
      { bytes: new Uint8Array([2]), durationMs: 2500 }
    ]);
    const source = file("lecture.m4a", 8_000_000);
    const prepared = await prepareFilesForAsr([source]);
    expect(prepared.map((part) => part.file.name)).toEqual(["p00_lecture.wav", "p01_lecture.wav"]);
    expect(prepared.map((part) => part.orderLabel)).toEqual([
      "第 1/2 段 · 约 0:00–0:01", "第 2/2 段 · 约 0:01–0:04"
    ]);
    expect(prepared.every((part) => part.file.lastModified === source.lastModified)).toBe(true);
    expect(audio.decode).toHaveBeenCalledTimes(2);
    expect(audio.close).toHaveBeenCalledTimes(2);
  });

  it("M4A中间段失败报告具体段号，已创建解码器全部释放", async () => {
    audio.split.mockReturnValue([
      { bytes: new Uint8Array([1]), durationMs: 1000 },
      { bytes: new Uint8Array([2]), durationMs: 1000 }
    ]);
    audio.decode.mockResolvedValueOnce(pcm()).mockRejectedValueOnce(new Error("AAC unavailable"));
    await expect(splitM4aFileForAsr(file("lecture.m4a"))).rejects.toThrow("M4A 第 2/2 段无法转换为 WAV（AAC unavailable）");
    expect(audio.close).toHaveBeenCalledTimes(2);
  });

  it("没有音频解码器时返回原有错误", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    await expect(convertAudioFileToSpeechParts(file("input.ogg"))).rejects.toThrow("当前环境不支持音频解码");
  });

  it("双声道混合不修改源采样，同采样率切片保留采样值", () => {
    const left = Float32Array.from([1, -1, 0.5, 0]);
    const right = Float32Array.from([0, 1, -0.5, 1]);
    const buffer = { length: 4, sampleRate: 4, numberOfChannels: 2,
      getChannelData: (channel: number) => channel === 0 ? left : right } as unknown as AudioBuffer;
    const mixed = mixToMonoSamples(buffer);
    expect([...mixed.samples]).toEqual([0.5, 0, 0, 0.5]);
    expect([...sliceAndResampleMono(mixed.samples, 4, 0.25, 0.5, 4)]).toEqual([0, 0]);
    expect([...left]).toEqual([1, -1, 0.5, 0]);
    expect([...right]).toEqual([0, 1, -0.5, 1]);
  });

  it("WAV输出保留RIFF、采样率及饱和后的16位PCM", async () => {
    const wav = encodeMonoWav(Float32Array.from([-2, -1, 0, 1, 2]), 16_000);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(wav);
    });
    const view = new DataView(buffer);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true)))
      .toEqual([-32768, -32768, 0, 32767, 32767]);
  });
});
