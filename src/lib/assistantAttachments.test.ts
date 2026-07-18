import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "pdf.worker.mjs" }));

import { prepareAiAssistantAttachment } from "./assistantAttachments";

describe("AI 助手附件", () => {
  beforeEach(() => getDocumentMock.mockReset());

  it("按扩展名识别移动端返回的空 MIME 图片", async () => {
    const attachment = await prepareAiAssistantAttachment(new File(["image"], "camera-photo.jpg"));
    expect(attachment).toMatchObject({
      name: "camera-photo.jpg",
      kind: "image",
      mimeType: "image/jpeg"
    });
    expect(attachment.dataUrl).toMatch(/^data:image\/jpeg/);
  });

  it("把没有文字层的扫描 PDF 转成页面图片", async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
          render
        })
      })
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,cGFnZQ==");

    const file = new File(["scan"], "扫描讲义.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("scan").buffer });
    const attachment = await prepareAiAssistantAttachment(file);

    expect(attachment).toMatchObject({
      name: "扫描讲义.pdf",
      kind: "document",
      pageCount: 2,
      processedPageCount: 2
    });
    expect(attachment.pageImages).toHaveLength(2);
    expect(attachment.notice).toContain("已读取 2 页");
    expect(render).toHaveBeenCalledTimes(2);
  });
});
