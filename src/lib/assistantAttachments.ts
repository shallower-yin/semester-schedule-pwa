import type { PDFPageProxy } from "pdfjs-dist";
import { supabase } from "./supabase";

export interface AiRemoteDocumentPage {
  objectKey: string;
  pageNumber: number;
  mimeType: "image/jpeg";
  size: number;
}

export interface AiAttachmentProcessingUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AiAssistantAttachment {
  name: string;
  mimeType: string;
  kind: "image" | "document";
  dataUrl?: string;
  text?: string;
  pageImages?: string[];
  remotePages?: AiRemoteDocumentPage[];
  documentId?: string;
  pageCount?: number;
  processedPageCount?: number;
  notice?: string;
  processingUsage?: AiAttachmentProcessingUsage;
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
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 40_000;
const MAX_PDF_IMAGE_PAGES = 24;
const MAX_PDF_TOTAL_PAGES = 120;
const MAX_PDF_IMAGE_DATA_CHARS = 7_000_000;
const MAX_PDF_IMAGE_DIMENSION = 1400;
const PDF_UPLOAD_BATCH_SIZE = 8;
const PDF_EXTRACTION_BATCH_SIZE = 6;

export const AI_IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/bmp";
export const AI_DOCUMENT_ACCEPT = "application/pdf,.docx,.txt,.md,.csv";

export async function prepareAiAssistantAttachment(file: File, options: {
  accessCode?: string;
  feature?: "assistant" | "mind_map";
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
} = {}): Promise<AiAssistantAttachment> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredImageType = imageMimeTypeForExtension(extension);
  const imageMimeType = IMAGE_TYPES.has(file.type) ? file.type : inferredImageType;
  if (imageMimeType) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 6 MB。");
    return { name: file.name, mimeType: imageMimeType, kind: "image", dataUrl: await readDataUrl(file, imageMimeType) };
  }
  const isPdf = file.type === "application/pdf" || extension === "pdf";
  if (file.size > (isPdf ? MAX_PDF_BYTES : MAX_DOCUMENT_BYTES)) {
    throw new Error(isPdf ? "单个 PDF 不能超过 100 MB。" : "单个文档不能超过 12 MB。");
  }

  if (isPdf) return await extractPdfAttachment(file, options);

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

async function extractPdfAttachment(file: File, options: {
  accessCode?: string;
  feature?: "assistant" | "mind_map";
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}): Promise<AiAssistantAttachment> {
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

  if (document.numPages > MAX_PDF_IMAGE_PAGES) {
    return await uploadScannedPdfPages(file, document, options);
  }

  const pageImages: string[] = [];
  let dataChars = 0;
  const pageLimit = Math.min(document.numPages, MAX_PDF_IMAGE_PAGES);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const dataUrl = await renderPdfPageImage(page);
    if (pageImages.length > 0 && dataChars + dataUrl.length > MAX_PDF_IMAGE_DATA_CHARS) {
      return await uploadScannedPdfPages(file, document, options);
    }
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

async function uploadScannedPdfPages(
  file: File,
  document: { numPages: number; getPage: (pageNumber: number) => Promise<PDFPageProxy> },
  options: {
    accessCode?: string;
    feature?: "assistant" | "mind_map";
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<AiAssistantAttachment> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法读取长篇扫描 PDF。");
  const total = Math.min(document.numPages, MAX_PDF_TOTAL_PAGES);
  const remotePages: AiRemoteDocumentPage[] = [];
  let documentId = "";
  options.onProgress?.(0, total);
  try {
    for (let start = 1; start <= total; start += PDF_UPLOAD_BATCH_SIZE) {
      throwIfAborted(options.signal);
      const pageNumbers = Array.from({ length: Math.min(PDF_UPLOAD_BATCH_SIZE, total - start + 1) }, (_, index) => start + index);
      const rendered = await mapWithConcurrency(pageNumbers, 2, async (pageNumber) => {
        throwIfAborted(options.signal);
        const page = await document.getPage(pageNumber);
        return { pageNumber, blob: await renderPdfPageBlob(page) };
      });
      const { data, error } = await supabase.functions.invoke<{
        documentId: string;
        uploads: Array<{ pageNumber: number; objectKey: string; uploadUrl: string }>;
      }>("ai-assistant", {
        signal: options.signal,
        body: {
          action: "create_document_page_uploads",
          accessCode: options.accessCode?.trim() || undefined,
          document: {
            documentId: documentId || undefined,
            name: file.name,
            pageCount: total,
            feature: options.feature ?? "assistant",
            pages: rendered.map(({ pageNumber, blob }) => ({ pageNumber, size: blob.size, mimeType: "image/jpeg" }))
          }
        }
      });
      if (error || !data?.uploads?.length) throw new Error(await functionErrorMessage(error, "无法创建 PDF 页面上传任务。"));
      documentId = data.documentId;
      const renderedByPage = new Map(rendered.map((item) => [item.pageNumber, item.blob]));
      const uploaded = await mapWithConcurrency(data.uploads, 3, async (ticket) => {
        throwIfAborted(options.signal);
        const blob = renderedByPage.get(ticket.pageNumber);
        if (!blob) throw new Error(`PDF 第 ${ticket.pageNumber} 页读取失败。`);
        const response = await fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: blob,
          signal: options.signal
        });
        if (!response.ok) throw new Error(`PDF 第 ${ticket.pageNumber} 页上传失败（HTTP ${response.status}）。`);
        return { objectKey: ticket.objectKey, pageNumber: ticket.pageNumber, mimeType: "image/jpeg" as const, size: blob.size };
      });
      remotePages.push(...uploaded);
      options.onProgress?.(remotePages.length, total);
    }
  } catch (error) {
    await releaseAiAssistantAttachments([{ name: file.name, mimeType: "application/pdf", kind: "document", documentId, remotePages }]);
    throw error;
  }
  const notice = document.numPages > total
    ? `扫描版 PDF 共 ${document.numPages} 页，当前支持读取前 ${total} 页`
    : `扫描版 PDF 已上传 ${total} 页，将由 AI 分批读取`;
  return {
    name: file.name,
    mimeType: file.type || "application/pdf",
    kind: "document",
    text: notice,
    remotePages,
    documentId,
    pageCount: document.numPages,
    processedPageCount: 0,
    notice
  };
}

export async function processAiRemoteDocumentAttachments(attachments: AiAssistantAttachment[], options: {
  accessCode?: string;
  feature?: "assistant" | "mind_map";
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  onUpdate?: (attachments: AiAssistantAttachment[]) => void;
} = {}): Promise<AiAssistantAttachment[]> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法读取长篇扫描 PDF。");
  const working = attachments.map(cloneAttachment);
  const totals = working.map((attachment) => attachmentProgress(attachment));
  const total = totals.reduce((sum, value) => sum + value.total, 0);
  let completed = totals.reduce((sum, value) => sum + value.completed, 0);
  options.onProgress?.(completed, total);

  for (let attachmentIndex = 0; attachmentIndex < working.length; attachmentIndex += 1) {
    let attachment = working[attachmentIndex];
    let remaining = [...(attachment.remotePages ?? [])].sort((left, right) => left.pageNumber - right.pageNumber);
    if (!remaining.length) continue;
    const progress = attachmentProgress(attachment);
    const textParts = progress.completed > 0 && attachment.text?.trim() ? [attachment.text.trim()] : [];
    let processedPageCount = progress.completed;
    let processingUsage = normalizeProcessingUsage(attachment.processingUsage);

    while (remaining.length) {
      throwIfAborted(options.signal);
      const batch = remaining.slice(0, PDF_EXTRACTION_BATCH_SIZE);
      const firstPage = batch[0].pageNumber;
      const lastPage = batch[batch.length - 1].pageNumber;
      const { data, error } = await supabase.functions.invoke<{
        text?: string;
        usage?: Partial<AiAttachmentProcessingUsage>;
      }>("ai-assistant", {
        signal: options.signal,
        body: {
          action: "extract_document_batch",
          accessCode: options.accessCode?.trim() || undefined,
          attachments: [{
            name: attachment.name,
            mimeType: attachment.mimeType,
            kind: "document",
            documentId: attachment.documentId,
            pageCount: attachment.pageCount,
            remotePages: batch
          }],
          document: { feature: options.feature ?? "assistant" }
        }
      });
      if (error || !data?.text?.trim()) {
        const reason = await functionErrorMessage(error, `扫描 PDF 第 ${firstPage}-${lastPage} 页读取失败。`);
        throw new Error(`扫描 PDF 已读取 ${processedPageCount}/${progress.total} 页；${reason} 已完成内容已保留，重试将从未完成页继续。`);
      }

      textParts.push(`第 ${firstPage}-${lastPage} 页：\n${data.text.trim()}`);
      processingUsage = combineProcessingUsage(processingUsage, normalizeProcessingUsage(data.usage));
      remaining = remaining.slice(batch.length);
      processedPageCount += batch.length;
      completed += batch.length;
      attachment = {
        ...attachment,
        text: textParts.join("\n\n").slice(0, 100_000),
        remotePages: remaining.length ? remaining : undefined,
        processedPageCount,
        processingUsage,
        notice: remaining.length
          ? `扫描版 PDF 已读取 ${processedPageCount}/${progress.total} 页`
          : `扫描版 PDF 已完成 ${processedPageCount} 页读取`
      };
      working[attachmentIndex] = attachment;
      options.onProgress?.(completed, total);
      options.onUpdate?.(working.map(cloneAttachment));
    }
  }
  return working;
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

async function renderPdfPageBlob(page: PDFPageProxy): Promise<Blob> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, MAX_PDF_IMAGE_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("当前浏览器无法读取扫描版 PDF 页面。");
  return blob;
}

export async function releaseAiAssistantAttachments(attachments: AiAssistantAttachment[]): Promise<void> {
  if (!supabase) return;
  const objectKeys = attachments.flatMap((attachment) => attachment.remotePages?.map((page) => page.objectKey) ?? []);
  if (!objectKeys.length) return;
  await supabase.functions.invoke("ai-assistant", {
    body: { action: "delete_document_uploads", document: { objectKeys } }
  }).catch(() => undefined);
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      // Use the fallback below.
    }
  }
  return error instanceof Error && error.message && !error.message.includes("non-2xx") ? error.message : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("操作已取消。", "AbortError");
}

function cloneAttachment(attachment: AiAssistantAttachment): AiAssistantAttachment {
  return {
    ...attachment,
    remotePages: attachment.remotePages?.map((page) => ({ ...page })),
    pageImages: attachment.pageImages ? [...attachment.pageImages] : undefined,
    processingUsage: attachment.processingUsage ? { ...attachment.processingUsage } : undefined
  };
}

function attachmentProgress(attachment: AiAssistantAttachment): { completed: number; total: number } {
  const remaining = attachment.remotePages?.length ?? 0;
  const hasExtractedText = Boolean(attachment.text?.trim()) && !/将由 AI 分批读取|已上传 \d+ 页/.test(attachment.text ?? "");
  const reported = hasExtractedText ? Math.max(0, Number(attachment.processedPageCount) || 0) : 0;
  return { completed: reported, total: reported + remaining };
}

function normalizeProcessingUsage(value: Partial<AiAttachmentProcessingUsage> | undefined): AiAttachmentProcessingUsage {
  const promptTokens = Math.max(0, Math.round(Number(value?.prompt_tokens) || 0));
  const completionTokens = Math.max(0, Math.round(Number(value?.completion_tokens) || 0));
  const totalTokens = Math.max(0, Math.round(Number(value?.total_tokens) || 0)) || promptTokens + completionTokens;
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
}

function combineProcessingUsage(left: AiAttachmentProcessingUsage, right: AiAttachmentProcessingUsage): AiAttachmentProcessingUsage {
  return {
    prompt_tokens: left.prompt_tokens + right.prompt_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    total_tokens: left.total_tokens + right.total_tokens
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
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
