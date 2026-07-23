import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: invokeMock } }
}));

import { transcribeAudioFiles } from "./audioTranscription";

describe("R2 音频转写上传", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  it("多段音频直传 R2 后按文件逐段转写（避免单次任务过大超时）", async () => {
    let uploadIndex = 0;
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        uploadIndex += 1;
        return {
          data: {
            objectKey: `ai-audio/user-1/audio-${uploadIndex}.mp3`,
            uploadUrl: `https://upload.example/audio-${uploadIndex}`,
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.action === "plan_audio_transcription") {
        return { data: { strategy: "single", totalChunks: 2, tasks: [] }, error: null };
      }
      if (options.body.action === "delete_audio_upload") {
        return { data: { ok: true }, error: null };
      }
      const audios = options.body.audios as Array<{ name?: string }> | undefined;
      const name = audios?.[0]?.name ?? "";
      const transcript = name.includes("上半场") ? "第一段内容" : name.includes("下半场") ? "第二段内容" : "转写完成";
      return {
        data: { transcript, summary: null, model: "mimo-v2.5-audio-url" },
        error: null
      };
    });

    const result = await transcribeAudioFiles({
      files: [
        new File(["first"], "上半场.mp3", { type: "audio/mpeg" }),
        new File(["second"], "下半场.mp3", { type: "audio/mpeg" })
      ],
      language: "zh",
      summarize: false
    });

    const transcriptionCalls = invokeMock.mock.calls.filter(([, options]) => options.body.mode === "audio_transcription");
    expect(transcriptionCalls).toHaveLength(2);
    expect(transcriptionCalls[0][1].body.audios).toHaveLength(1);
    expect(transcriptionCalls[1][1].body.audios).toHaveLength(1);
    expect(JSON.stringify(transcriptionCalls[0][1].body)).not.toContain("base64");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.files).toEqual(["上半场.mp3", "下半场.mp3"]);
    // Chronological join: first selected file text appears before second.
    expect(result.transcript.indexOf("第一段内容")).toBeLessThan(result.transcript.indexOf("第二段内容"));
  });

  it("客户端小分段使用签名叶子任务，整份录音只走一次最终额度登记", async () => {
    let uploadIndex = 0;
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        uploadIndex += 1;
        return {
          data: {
            objectKey: `ai-audio/user-1/part-${uploadIndex}.wav`,
            uploadUrl: `https://upload.example/part-${uploadIndex}`,
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.action === "plan_audio_parts") {
        const audios = options.body.audios as Array<{ name: string; mimeType: string; size: number; objectKey: string }>;
        return {
          data: {
            tasks: audios.map((audio, index) => ({
              ...audio,
              fileIndex: index,
              fileName: audio.name,
              language: "zh",
              partIndex: index,
              partCount: audios.length,
              signature: `signed-${index}`
            }))
          },
          error: null
        };
      }
      if (options.body.action === "transcribe_audio_part") {
        const part = options.body.audioPart as { partIndex: number };
        return { data: { transcript: `签名分段${part.partIndex + 1}`, model: "mimo-v2.5-asr-signed-part" }, error: null };
      }
      if (options.body.action === "finalize_audio_transcription") {
        return { data: { transcript: "server-order", summary: null, warning: null, model: "finalized" }, error: null };
      }
      return { data: { ok: true }, error: null };
    });

    const result = await transcribeAudioFiles({
      files: [
        new File(["part-1"], "第一段.wav", { type: "audio/wav" }),
        new File(["part-2"], "第二段.wav", { type: "audio/wav" })
      ],
      language: "zh",
      summarize: false
    });

    expect(invokeMock.mock.calls.filter(([, options]) => options.body.action === "transcribe_audio_part")).toHaveLength(2);
    expect(invokeMock.mock.calls.filter(([, options]) => options.body.action === "finalize_audio_transcription")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([, options]) => options.body.mode === "audio_transcription")).toHaveLength(0);
    expect(result.transcript.indexOf("签名分段1")).toBeLessThan(result.transcript.indexOf("签名分段2"));
  });

  it("中间段失败后继续转写后续段，并保持时间顺序", async () => {
    let uploadIndex = 0;
    let asrCalls = 0;
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        uploadIndex += 1;
        return {
          data: {
            objectKey: `ai-audio/user-1/audio-${uploadIndex}.wav`,
            uploadUrl: `https://upload.example/audio-${uploadIndex}`,
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.mode === "audio_transcription") {
        asrCalls += 1;
        const audios = options.body.audios as Array<{ name?: string }> | undefined;
        const name = audios?.[0]?.name ?? "";
        if (name.includes("02")) {
          // Non-transient 4xx so the test does not wait on gateway/fetch retries.
          return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
            name: "FunctionsHttpError",
            context: new Response(JSON.stringify({ error: "本段模拟失败" }), { status: 400 })
          }) };
        }
        return {
          data: { transcript: `内容${name}`, summary: null, model: "mimo-v2.5-asr-chunked" },
          error: null
        };
      }
      return { data: { ok: true }, error: null };
    });

    const partial = vi.fn();
    const result = await transcribeAudioFiles({
      files: [
        new File(["a"], "seg-01.mp3", { type: "audio/mpeg" }),
        new File(["b"], "seg-02.mp3", { type: "audio/mpeg" }),
        new File(["c"], "seg-03.mp3", { type: "audio/mpeg" })
      ],
      language: "zh",
      summarize: false,
      onPartialResult: partial
    });

    // One attempt per part (middle fails once with non-transient error); later parts still run.
    expect(asrCalls).toBe(3);
    expect(result.transcript.indexOf("内容seg-01.mp3")).toBeLessThan(result.transcript.indexOf("本段转写失败"));
    expect(result.transcript.indexOf("本段转写失败")).toBeLessThan(result.transcript.indexOf("内容seg-03.mp3"));
    expect(result.warning).toMatch(/部分完成/);
    expect(partial).toHaveBeenCalled();
    expect(partial.mock.calls.some(([checkpoint]) => checkpoint.transcript.includes("内容seg-01.mp3"))).toBe(true);
  });

  it("大 MP3 走分段计划并上报 1/N 进度，且不会回退成 1/1 整包", async () => {
    const progress = vi.fn();
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }) => {
      if (options.body.action === "create_audio_upload") {
        return {
          data: {
            objectKey: "ai-audio/user-1/long.mp3",
            uploadUrl: "https://upload.example/long",
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.action === "plan_audio_transcription") {
        return {
          data: {
            strategy: "progressive",
            totalChunks: 2,
            tasks: [
              {
                fileIndex: 0,
                fileName: "long.mp3",
                objectKey: "ai-audio/user-1/long.mp3",
                chunkIndex: 0,
                chunkCount: 2,
                language: "zh",
                nominalStart: 0,
                nominalEnd: 100,
                fetchStart: 0,
                fetchEnd: 100,
                signature: "sig-1"
              },
              {
                fileIndex: 0,
                fileName: "long.mp3",
                objectKey: "ai-audio/user-1/long.mp3",
                chunkIndex: 1,
                chunkCount: 2,
                language: "zh",
                nominalStart: 101,
                nominalEnd: 200,
                fetchStart: 90,
                fetchEnd: 200,
                signature: "sig-2"
              }
            ]
          },
          error: null
        };
      }
      if (options.body.action === "transcribe_audio_range") {
        const chunkIndex = Number((options.body.audioRange as { chunkIndex?: number })?.chunkIndex ?? 0);
        return { data: { transcript: `段${chunkIndex + 1}` }, error: null };
      }
      if (options.body.action === "summarize_audio_transcript") {
        return {
          data: { transcript: String(options.body.audioTranscript ?? ""), summary: "摘要", model: "transcript-summary" },
          error: null
        };
      }
      if (options.body.action === "finalize_audio_transcription") {
        return { data: null, error: new Error("should-use-text-only-summary") };
      }
      // Monolithic single-job mode must not be used for large MP3.
      if (options.body.mode === "audio_transcription") {
        return { data: null, error: new Error("should-not-fallback-to-single") };
      }
      return { data: null, error: new Error("unexpected") };
    });

    const large = new File([new Uint8Array(8)], "long.mp3", { type: "audio/mpeg" });
    Object.defineProperty(large, "size", { value: 8 * 1024 * 1024 });
    const result = await transcribeAudioFiles({
      files: [large],
      language: "zh",
      summarize: true,
      onProgress: progress
    });

    expect(result.transcript).toContain("段1");
    expect(result.transcript).toContain("段2");
    expect(result.summary).toBe("摘要");
    expect(progress.mock.calls.some((call) => String(call[2]).includes("已成功"))).toBe(true);
    const rangeCalls = invokeMock.mock.calls.filter(([, options]) => options.body.action === "transcribe_audio_range");
    expect(rangeCalls).toHaveLength(2);
    const singleJobs = invokeMock.mock.calls.filter(([, options]) => options.body.mode === "audio_transcription");
    expect(singleJobs).toHaveLength(0);
    const summaryCalls = invokeMock.mock.calls.filter(([, options]) => options.body.action === "summarize_audio_transcript");
    expect(summaryCalls).toHaveLength(1);
  });

  it("大 MP3 若云端未返回分段计划则直接失败，禁止 1/1 整包", async () => {
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        return {
          data: {
            objectKey: "ai-audio/user-1/long.mp3",
            uploadUrl: "https://upload.example/long",
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.action === "plan_audio_transcription") {
        return { data: { strategy: "single", totalChunks: 1, tasks: [] }, error: null };
      }
      return { data: null, error: new Error("unexpected single job") };
    });
    const large = new File([new Uint8Array(8)], "1. 张宏伟1.mp3", { type: "audio/mpeg" });
    Object.defineProperty(large, "size", { value: 49.7 * 1024 * 1024 });
    await expect(transcribeAudioFiles({
      files: [large],
      language: "auto",
      summarize: true
    })).rejects.toThrow(/分段计划|多段/);
  });

  it("多文件中混有大 MP3 时只对大文件分段，并保留全部文件顺序", async () => {
    let uploadIndex = 0;
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        uploadIndex += 1;
        const extension = uploadIndex === 1 ? "mp3" : "wav";
        return {
          data: {
            objectKey: `ai-audio/user-1/audio-${uploadIndex}.${extension}`,
            uploadUrl: `https://upload.example/audio-${uploadIndex}`,
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      if (options.body.action === "plan_audio_transcription") {
        return {
          data: {
            strategy: "progressive",
            totalChunks: 2,
            tasks: [0, 1].map((chunkIndex) => ({
              fileIndex: 0,
              fileName: "long.mp3",
              objectKey: "ai-audio/user-1/audio-1.mp3",
              chunkIndex,
              chunkCount: 2,
              language: "zh",
              nominalStart: chunkIndex * 100,
              nominalEnd: chunkIndex * 100 + 99,
              fetchStart: chunkIndex * 100,
              fetchEnd: chunkIndex * 100 + 99,
              signature: `sig-${chunkIndex}`
            }))
          },
          error: null
        };
      }
      if (options.body.action === "transcribe_audio_range") {
        const chunk = Number((options.body.audioRange as { chunkIndex?: number }).chunkIndex ?? 0);
        return { data: { transcript: `长录音第${chunk + 1}段` }, error: null };
      }
      if (options.body.mode === "audio_transcription") {
        return { data: { transcript: "短录音内容", summary: null, model: "mimo-v2.5-asr-chunked" }, error: null };
      }
      return { data: { ok: true }, error: null };
    });

    const large = new File([new Uint8Array(8)], "long.mp3", { type: "audio/mpeg" });
    Object.defineProperty(large, "size", { value: 8 * 1024 * 1024 });
    const result = await transcribeAudioFiles({
      files: [large, new File(["short"], "short.wav", { type: "audio/wav" })],
      language: "zh",
      summarize: false
    });

    expect(result.transcript).toContain("长录音第1段");
    expect(result.transcript).toContain("长录音第2段");
    expect(result.transcript).toContain("短录音内容");
    expect(result.transcript.indexOf("长录音第1段")).toBeLessThan(result.transcript.indexOf("短录音内容"));
  });

  it("后续文件上传失败时清理已经上传的临时对象", async () => {
    let uploadIndex = 0;
    invokeMock.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === "create_audio_upload") {
        uploadIndex += 1;
        return {
          data: {
            objectKey: `ai-audio/user-1/audio-${uploadIndex}.mp3`,
            uploadUrl: `https://upload.example/audio-${uploadIndex}`,
            expiresAt: new Date().toISOString()
          },
          error: null
        };
      }
      return { data: { ok: true }, error: null };
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValue(new Response(null, { status: 500 })));

    await expect(transcribeAudioFiles({
      files: [
        new File(["first"], "上半场.mp3", { type: "audio/mpeg" }),
        new File(["second"], "下半场.mp3", { type: "audio/mpeg" })
      ],
      language: "auto",
      summarize: false
    })).rejects.toThrow("音频上传失败");

    const cleanupCalls = invokeMock.mock.calls.filter(([, options]) => options.body.action === "delete_audio_upload");
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0][1].body.audio).toEqual({ objectKey: "ai-audio/user-1/audio-1.mp3" });
  });
});
