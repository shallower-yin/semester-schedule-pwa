import { describe, expect, it } from "vitest";
import { prepareAiAssistantAttachment } from "./assistantAttachments";

describe("AI 助手附件", () => {
  it("按扩展名识别移动端返回的空 MIME 图片", async () => {
    const attachment = await prepareAiAssistantAttachment(new File(["image"], "camera-photo.jpg"));
    expect(attachment).toMatchObject({
      name: "camera-photo.jpg",
      kind: "image",
      mimeType: "image/jpeg"
    });
    expect(attachment.dataUrl).toMatch(/^data:image\/jpeg/);
  });
});
