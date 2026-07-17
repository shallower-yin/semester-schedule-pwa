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

  it("多段音频直传 R2 后只提交一次转写任务", async () => {
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
      return {
        data: { transcript: "转写完成", summary: null, model: "mimo-v2.5-audio-url" },
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
    expect(transcriptionCalls).toHaveLength(1);
    expect(transcriptionCalls[0][1].body.audios).toHaveLength(2);
    expect(JSON.stringify(transcriptionCalls[0][1].body)).not.toContain("base64");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.files).toEqual(["上半场.mp3", "下半场.mp3"]);
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
