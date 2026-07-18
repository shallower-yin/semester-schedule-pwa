import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDocumentMock, invokeMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn(), invokeMock: vi.fn() }));

vi.mock("./supabase", () => ({ supabase: { functions: { invoke: invokeMock } } }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "pdf.worker.mjs" }));

import { prepareAiAssistantAttachment } from "./assistantAttachments";

describe("AI 助手附件", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
    invokeMock.mockReset();
  });

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

  it("长扫描 PDF 分批上传全部页面而不是截断为 24 页", async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 25,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
          render
        })
      })
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["page"], { type: "image/jpeg" })));
    invokeMock.mockImplementation(async (_name: string, options: { body: { document: { documentId?: string; pages: Array<{ pageNumber: number }> } } }) => ({
      data: {
        documentId: options.body.document.documentId ?? "11111111-1111-4111-8111-111111111111",
        uploads: options.body.document.pages.map(({ pageNumber }) => ({
          pageNumber,
          objectKey: `ai-documents/user-1/11111111-1111-4111-8111-111111111111/page-${String(pageNumber).padStart(4, "0")}.jpg`,
          uploadUrl: `https://r2.test/page-${pageNumber}`
        }))
      },
      error: null
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const progress = vi.fn();
    const file = new File(["scan"], "long-scan.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("scan").buffer });

    const attachment = await prepareAiAssistantAttachment(file, { feature: "mind_map", onProgress: progress });

    expect(attachment.pageImages).toBeUndefined();
    expect(attachment.remotePages).toHaveLength(25);
    expect(attachment.processedPageCount).toBe(25);
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(25);
    expect(progress).toHaveBeenLastCalledWith(25, 25);
  });
});
