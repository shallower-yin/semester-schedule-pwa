import { describe, expect, it } from "vitest";
import {
  AI_MODEL_OPTIONS,
  AUDIO_MODEL_OPTIONS,
  aiModelSupportsAttachments,
  defaultAiModel,
  defaultAudioModel,
  isSupportedAiModel,
  isSupportedAudioModel
} from "./aiModels";

describe("AI 模型目录", () => {
  it("只提供内置聊天模型", () => {
    expect(AI_MODEL_OPTIONS.deepseek.map((item) => item.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(AI_MODEL_OPTIONS.mimo.map((item) => item.id)).toEqual(["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.5-pro-ultraspeed"]);
    expect(AI_MODEL_OPTIONS.siliconflow.map((item) => item.id)).toEqual(["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"]);
    expect(AI_MODEL_OPTIONS.tju.map((item) => item.id)).toEqual(["tju-llm"]);
    expect(defaultAiModel("mimo")).toBe("mimo-v2.5");
    expect(defaultAiModel("siliconflow")).toBe("Qwen/Qwen3-32B");
    expect(defaultAiModel("tju")).toBe("tju-llm");
    expect(isSupportedAiModel("deepseek", "custom-model")).toBe(false);
  });

  it("音频转写只提供 MiMo 和硅基流动 ASR 模型", () => {
    expect(AUDIO_MODEL_OPTIONS.mimo.map((item) => item.id)).toEqual(["mimo-v2.5-asr"]);
    expect(AUDIO_MODEL_OPTIONS.siliconflow.map((item) => item.id)).toContain("TeleAI/TeleSpeechASR");
    expect(defaultAudioModel("siliconflow")).toBe("TeleAI/TeleSpeechASR");
    expect(isSupportedAudioModel("mimo", "mimo-v2.5-asr")).toBe(true);
    expect(isSupportedAudioModel("siliconflow", "mimo-v2.5-asr")).toBe(false);
  });

  it("只有 MiMo V2.5 开放附件入口", () => {
    expect(aiModelSupportsAttachments("mimo", "mimo-v2.5")).toBe(true);
    expect(aiModelSupportsAttachments("mimo", "mimo-v2.5-pro")).toBe(false);
    expect(aiModelSupportsAttachments("deepseek", "deepseek-v4-pro")).toBe(false);
    expect(aiModelSupportsAttachments("siliconflow", "Qwen/Qwen3-32B")).toBe(false);
    expect(aiModelSupportsAttachments("tju", "tju-llm")).toBe(false);
  });
});
