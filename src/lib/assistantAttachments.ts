import type { PDFPageProxy } from "pdfjs-dist";

export interface AiAssistantAttachment {
  name: string;
  mimeType: string;
  kind: "image" | "document";
  dataUrl?: string;
  text?: string;
  pageImages?: string[];
  pageCount?: number;
  processedPageCount?: number;
  notice?: string;
}

export interface AiAttachmentContextRecord {
  id: string;
  ownerId: string;
  attachments: AiAssistantAttachment[];
  updatedAt: string;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 40_000;
const MAX_PDF_IMAGE_PAGES = 24;
const MAX_PDF_IMAGE_DATA_CHARS = 7_000_000;
const MAX_PDF_IMAGE_DIMENSION = 1400;

export const AI_IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/bmp";
export const AI_DOCUMENT_ACCEPT = "application/pdf,.docx,.txt,.md,.csv";

export async function prepareAiAssistantAttachment(file: File): Promise<AiAssistantAttachment> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredImageType = imageMimeTypeForExtension(extension);
  const imageMimeType = IMAGE_TYPES.has(file.type) ? file.type : inferredImageType;
  if (imageMimeType) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 6 MB。");
    return { name: file.name, mimeType: imageMimeType, kind: "image", dataUrl: await readDataUrl(file, imageMimeType) };
  }
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("单个文档不能超过 12 MB。");

  if (file.type === "application/pdf" || extension === "pdf") return await extractPdfAttachment(file);

  let text = "";
  if (extension === "docx") text = await extractDocxText(file);
  else if (["txt", "md", "csv"].includes(extension) || file.type.startsWith("text/")) text = await file.text();
  else throw new Error("暂不支持该文件格式，请使用图片、PDF、DOCX、TXT、Markdown 或 CSV。");

  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("没有从该文档中读取到文字内容。");
  return {
    name: file.name,
    mimeType: file.type || mimeTypeForExtension(extension),
    kind: "document",
    text: normalized.slice(0, MAX_DOCUMENT_TEXT)
  };
}

async function extractPdfAttachment(file: File): Promise<AiAssistantAttachment> {
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url")
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 120); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    if (pageTexts.join("\n").length >= MAX_DOCUMENT_TEXT) break;
  }
  const normalized = pageTexts.join("\n").replace(/\u0000/g, "").trim();
  if (normalized) {
    return {
      name: file.name,
      mimeType: file.type || "application/pdf",
      kind: "document",
      text: normalized.slice(0, MAX_DOCUMENT_TEXT)
    };
  }

  const pageImages: string[] = [];
  let dataChars = 0;
  const pageLimit = Math.min(document.numPages, MAX_PDF_IMAGE_PAGES);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const dataUrl = await renderPdfPageImage(page);
    if (pageImages.length > 0 && dataChars + dataUrl.length > MAX_PDF_IMAGE_DATA_CHARS) break;
    pageImages.push(dataUrl);
    dataChars += dataUrl.length;
  }
  if (!pageImages.length) throw new Error("没有从该 PDF 中读取到文字或页面图像。");
  const notice = pageImages.length < document.numPages
    ? `扫描版 PDF 共 ${document.numPages} 页，本次读取前 ${pageImages.length} 页`
    : `扫描版 PDF 已读取 ${pageImages.length} 页`;
  return {
    name: file.name,
    mimeType: file.type || "application/pdf",
    kind: "document",
    text: notice,
    pageImages,
    pageCount: document.numPages,
    processedPageCount: pageImages.length,
    notice
  };
}

async function renderPdfPageImage(page: PDFPageProxy): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, MAX_PDF_IMAGE_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
  canvas.width = 1;
  canvas.height = 1;
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("当前浏览器无法读取扫描版 PDF 页面。");
  return dataUrl;
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

function readDataUrl(file: File, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(file.type ? result : result.replace(/^data:application\/octet-stream/i, `data:${mimeType}`));
    };
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

function imageMimeTypeForExtension(extension: string): string {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "bmp") return "image/bmp";
  return "";
}

function mimeTypeForExtension(extension: string): string {
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "csv") return "text/csv";
  if (extension === "md") return "text/markdown";
  return "text/plain";
}
