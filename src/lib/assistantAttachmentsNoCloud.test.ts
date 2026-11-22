import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: null }));
import { processAiRemoteDocumentAttachments } from "./assistantAttachments";

describe("附件无需额外处理时不依赖云端配置", () => {
  it("纯聊天、普通图片和已提取文本直接进入后续助手调用", async () => {
    expect(await processAiRemoteDocumentAttachments([])).toEqual([]);
    const attachments = [{ kind: "image" as const, name: "image.png", mimeType: "image/png", dataUrl: "data:image/png;base64,aW1n" },
      { kind: "document" as const, name: "notes.txt", mimeType: "text/plain", text: "安排" }];
    expect(await processAiRemoteDocumentAttachments(attachments)).toEqual(attachments);
  });
  it("有待处理的远程内容时仍要求配置，取消信号仍生效", async () => {
    await expect(processAiRemoteDocumentAttachments([{ kind: "document", name: "notes.txt", mimeType: "text/plain", pendingTextBatches: [{ startPage: 1, endPage: 1, text: "长文" }] }])).rejects.toThrow("云端服务未配置");
    const controller = new AbortController(); controller.abort();
    await expect(processAiRemoteDocumentAttachments([], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
