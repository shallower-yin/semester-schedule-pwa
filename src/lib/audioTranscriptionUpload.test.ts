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

    const result = await transcribeAudioFiles({
      files: [
        new File(["a"], "seg-01.mp3", { type: "audio/mpeg" }),
        new File(["b"], "seg-02.mp3", { type: "audio/mpeg" }),
        new File(["c"], "seg-03.mp3", { type: "audio/mpeg" })
      ],
      language: "zh",
      summarize: false
    });

    // One attempt per part (middle fails once with non-transient error); later parts still run.
    expect(asrCalls).toBe(3);
    expect(result.transcript.indexOf("内容seg-01.mp3")).toBeLessThan(result.transcript.indexOf("本段转写失败"));
    expect(result.transcript.indexOf("本段转写失败")).toBeLessThan(result.transcript.indexOf("内容seg-03.mp3"));
    expect(result.warning).toMatch(/部分完成/);
  });

  it("大 MP3 走分段计划并上报 1/N 进度", async () => {
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
      if (options.body.action === "finalize_audio_transcription") {
        return {
          data: { transcript: "段1\n\n段2", summary: "摘要", model: "mimo-v2.5-asr-chunked" },
          error: null
        };
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
    expect(progress).toHaveBeenCalledWith(1, 2, "转写中");
    expect(progress).toHaveBeenCalledWith(2, 2, "转写中");
    expect(progress).toHaveBeenCalledWith(2, 2, "整理结果");
    const rangeCalls = invokeMock.mock.calls.filter(([, options]) => options.body.action === "transcribe_audio_range");
    expect(rangeCalls).toHaveLength(2);
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
      .mockResolvedValueOnce(new Response(null, { status: 500 })));

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
