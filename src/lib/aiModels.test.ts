import { describe, expect, it } from "vitest";
import { AI_MODEL_OPTIONS, aiModelSupportsAttachments, defaultAiModel, isSupportedAiModel } from "./aiModels";

describe("AI 模型目录", () => {
  it("提供商只能选择内置聊天模型", () => {
    expect(AI_MODEL_OPTIONS.deepseek.map((item) => item.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(AI_MODEL_OPTIONS.mimo.map((item) => item.id)).toEqual(["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.5-pro-ultraspeed"]);
    expect(defaultAiModel("mimo")).toBe("mimo-v2.5");
    expect(isSupportedAiModel("deepseek", "custom-model")).toBe(false);
  });

  it("只有 MiMo V2.5 开放附件入口", () => {
    expect(aiModelSupportsAttachments("mimo", "mimo-v2.5")).toBe(true);
    expect(aiModelSupportsAttachments("mimo", "mimo-v2.5-pro")).toBe(false);
    expect(aiModelSupportsAttachments("deepseek", "deepseek-v4-pro")).toBe(false);
  });
});
