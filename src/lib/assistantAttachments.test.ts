import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDocumentMock, invokeMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn(), invokeMock: vi.fn() }));

vi.mock("./supabase", () => ({ supabase: { functions: { invoke: invokeMock } } }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "pdf.worker.mjs" }));

import { prepareAiAssistantAttachment, processAiRemoteDocumentAttachments } from "./assistantAttachments";

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
    expect(attachment.processedPageCount).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(25);
    expect(progress).toHaveBeenLastCalledWith(25, 25);
  });

  it("按 6 页一批读取远程 PDF 并在每批后保留进度", async () => {
    const remotePages = Array.from({ length: 8 }, (_, index) => ({
      pageNumber: index + 1,
      objectKey: `ai-documents/user-1/doc/page-${String(index + 1).padStart(4, "0")}.jpg`,
      mimeType: "image/jpeg" as const,
      size: 1024
    }));
    invokeMock.mockImplementation(async (_name: string, options: { body: { action?: string; attachments?: Array<{ remotePages?: typeof remotePages }> } }) => {
      const pages = options.body.attachments?.[0]?.remotePages ?? [];
      return {
        data: {
          text: `读取第 ${pages[0]?.pageNumber}-${pages.at(-1)?.pageNumber} 页`,
          usage: { prompt_tokens: pages.length * 100, completion_tokens: pages.length * 10, total_tokens: pages.length * 110 }
        },
        error: null
      };
    });
    const onProgress = vi.fn();
    const onUpdate = vi.fn();

    const [attachment] = await processAiRemoteDocumentAttachments([{
      name: "长讲义.pdf",
      mimeType: "application/pdf",
      kind: "document",
      text: "扫描版 PDF 已上传 8 页，将由 AI 分批读取。",
      remotePages,
      pageCount: 8,
      processedPageCount: 0
    }], { feature: "mind_map", onProgress, onUpdate });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[0]?.[1]?.body.attachments[0].remotePages).toHaveLength(6);
    expect(invokeMock.mock.calls[1]?.[1]?.body.attachments[0].remotePages).toHaveLength(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 8);
    expect(onProgress).toHaveBeenNthCalledWith(2, 6, 8);
    expect(onProgress).toHaveBeenLastCalledWith(8, 8);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(attachment.remotePages).toBeUndefined();
    expect(attachment.processedPageCount).toBe(8);
    expect(attachment.text).toContain("读取第 1-6 页");
    expect(attachment.text).toContain("读取第 7-8 页");
    expect(attachment.processingUsage).toEqual({ prompt_tokens: 800, completion_tokens: 80, total_tokens: 880 });
  });
});
