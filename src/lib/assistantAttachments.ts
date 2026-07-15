export interface AiAssistantAttachment {
  name: string;
  mimeType: string;
  kind: "image" | "document";
  dataUrl?: string;
  text?: string;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 40_000;

export const AI_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/bmp,application/pdf,.docx,.txt,.md,.csv";

export async function prepareAiAssistantAttachment(file: File): Promise<AiAssistantAttachment> {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 6 MB。");
    return { name: file.name, mimeType: file.type, kind: "image", dataUrl: await readDataUrl(file) };
  }
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("单个文档不能超过 12 MB。");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let text = "";
  if (file.type === "application/pdf" || extension === "pdf") text = await extractPdfText(file);
  else if (extension === "docx") text = await extractDocxText(file);
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

async function extractPdfText(file: File): Promise<string> {
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
  return pageTexts.join("\n");
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

function mimeTypeForExtension(extension: string): string {
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "csv") return "text/csv";
  if (extension === "md") return "text/markdown";
  return "text/plain";
}
