import type { PDFPageProxy } from "pdfjs-dist";
import { supabase } from "./supabase";

export interface AiRemoteDocumentPage {
  objectKey: string;
  pageNumber: number;
  mimeType: "image/jpeg";
  size: number;
}

export interface AiDocumentTextBatch {
  startPage: number;
  endPage: number;
  text: string;
}

export interface AiAttachmentProcessingUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AiAssistantAttachment {
  id?: string;
  name: string;
  mimeType: string;
  kind: "image" | "document";
  dataUrl?: string;
  imageBlob?: Blob;
  imageObjectKey?: string;
  imageSize?: number;
  text?: string;
  pageImages?: string[];
  remotePages?: AiRemoteDocumentPage[];
  pendingTextBatches?: AiDocumentTextBatch[];
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
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MODEL_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 40_000;
const MAX_PDF_IMAGE_PAGES = 24;
const DEFAULT_MAX_PDF_TOTAL_PAGES = 120;
const MAX_PDF_IMAGE_DATA_CHARS = 7_000_000;
const MAX_PDF_IMAGE_DIMENSION = 1400;
const PDF_UPLOAD_BATCH_SIZE = 8;
const PDF_EXTRACTION_BATCH_SIZE = 6;
const PDF_TEXT_BATCH_CHARS = 48_000;

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
    if (file.size > INLINE_IMAGE_BYTES) {
      const imageBlob = file.size > MODEL_IMAGE_BYTES ? await adaptImage(file, MODEL_IMAGE_BYTES) : file;
      const preview = await adaptImage(file, INLINE_IMAGE_BYTES, 1600);
      return { name: file.name, mimeType: imageBlob.type || imageMimeType, kind: "image", imageBlob, dataUrl: await readDataUrl(preview, preview.type) };
    }
    return { name: file.name, mimeType: imageMimeType, kind: "image", dataUrl: await readDataUrl(file, imageMimeType) };
  }
  const isPdf = file.type === "application/pdf" || extension === "pdf";
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("单个文档不能超过 50 MB。");

  if (isPdf) return await extractPdfAttachment(file, options);

  let text = "";
  if (extension === "docx") text = await extractDocxText(file);
  else if (["txt", "md", "csv"].includes(extension) || file.type.startsWith("text/")) text = await file.text();
  else throw new Error("暂不支持该文件格式，请使用图片、PDF、DOCX、TXT、Markdown 或 CSV。");

  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("没有从该文档中读取到文字内容。");
  if (normalized.length > MAX_DOCUMENT_TEXT) {
    const pendingTextBatches: AiDocumentTextBatch[] = [];
    for (let offset = 0; offset < normalized.length; offset += PDF_TEXT_BATCH_CHARS) {
      const part = pendingTextBatches.length + 1;
      pendingTextBatches.push({ startPage: part, endPage: part, text: normalized.slice(offset, offset + PDF_TEXT_BATCH_CHARS) });
    }
    return { name: file.name, mimeType: file.type || mimeTypeForExtension(extension), kind: "document", pendingTextBatches, pageCount: pendingTextBatches.length, processedPageCount: 0 };
  }
  return {
    name: file.name,
    mimeType: file.type || mimeTypeForExtension(extension),
    kind: "document",
    text: normalized,
  };
}

async function adaptImage(file: Blob, byteLimit: number, previewDimension?: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = previewDimension ? Math.min(1, previewDimension / Math.max(bitmap.width, bitmap.height)) : 1;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备无法读取这张图片，请重试。");
    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (blob && blob.size <= byteLimit) return blob;
      scale *= 0.8;
    }
    throw new Error("当前设备未能完成图片读取，请重试。");
  } finally {
    bitmap.close();
  }
}

export async function withUploadedAiImages<T>(attachments: AiAssistantAttachment[], options: {
  accessCode?: string; feature?: "assistant" | "mind_map"; signal?: AbortSignal;
}, run: (attachments: AiAssistantAttachment[]) => Promise<T>): Promise<T> {
  const uploaded: string[] = [];
  try {
    const wire: AiAssistantAttachment[] = [];
    for (const attachment of attachments) {
      options.signal?.throwIfAborted();
      const { imageBlob, ...metadata } = attachment;
      if (!imageBlob) { wire.push(metadata); continue; }
      if (!supabase) throw new Error("云端服务未配置，暂时无法上传图片。");
      const { data, error } = await supabase.functions.invoke<{ objectKey: string; uploadUrl: string }>("ai-assistant", {
        signal: options.signal,
        body: { action: "create_image_upload", accessCode: options.accessCode, image: { name: attachment.name, mimeType: imageBlob.type || attachment.mimeType, size: imageBlob.size, feature: options.feature ?? "assistant" } }
      });
      if (error || !data?.uploadUrl || !data.objectKey) throw new Error(await functionErrorMessage(error, "图片上传准备失败，请重试。"));
      uploaded.push(data.objectKey);
      const response = await fetch(data.uploadUrl, { method: "PUT", body: imageBlob, headers: { "content-type": imageBlob.type || attachment.mimeType }, signal: options.signal });
      if (!response.ok) throw new Error(`图片上传失败（HTTP ${response.status}），请重试。`);
      wire.push({ ...metadata, imageObjectKey: data.objectKey, imageSize: imageBlob.size });
    }
    return await run(wire);
  } finally {
    for (const objectKey of uploaded) {
      await supabase?.functions.invoke("ai-assistant", { body: { action: "delete_image_upload", image: { objectKey } } }).catch(() => undefined);
    }
  }
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
  const configuredLimit = await configuredPdfPageLimit(options.accessCode, options.signal);
  if (document.numPages > configuredLimit) {
    throw new Error(`这份 PDF 共 ${document.numPages} 页，当前服务安全范围为 ${configuredLimit} 页。请联系管理员调整文档页数范围，或拆分后重试。`);
  }
  const pageTexts: Array<{ pageNumber: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    throwIfAborted(options.signal);
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\u0000/g, "").trim();
    if (text) pageTexts.push({ pageNumber, text });
  }
  const normalized = pageTexts.map((page) => page.text).join("\n").trim();
  if (normalized) {
    if (normalized.length > MAX_DOCUMENT_TEXT) {
      const pendingTextBatches = buildPdfTextBatches(pageTexts);
      const notice = `文本型 PDF 共 ${document.numPages} 页，将分 ${pendingTextBatches.length} 批整理`;
      return {
        name: file.name,
        mimeType: file.type || "application/pdf",
        kind: "document",
        text: notice,
        pendingTextBatches,
        pageCount: document.numPages,
        processedPageCount: 0,
        notice
      };
    }
    return {
      name: file.name,
      mimeType: file.type || "application/pdf",
      kind: "document",
      text: normalized,
      pageCount: document.numPages,
      processedPageCount: document.numPages
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
  const total = document.numPages;
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
      // Register the entire issued batch before PUTs, including responses lost after upload.
      remotePages.push(...data.uploads.map((ticket) => ({
        objectKey: ticket.objectKey,
        pageNumber: ticket.pageNumber,
        mimeType: "image/jpeg" as const,
        size: renderedByPage.get(ticket.pageNumber)?.size ?? 0
      })));
      await mapWithConcurrency(data.uploads, 3, async (ticket) => {
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
      });
      options.onProgress?.(remotePages.length, total);
    }
  } catch (error) {
    await releaseAiAssistantAttachments([{ name: file.name, mimeType: "application/pdf", kind: "document", documentId, remotePages }]);
    throw error;
  }
  const notice = `扫描版 PDF 已上传 ${total} 页，将由 AI 分批读取`;
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
  const working = attachments.map(cloneAttachment);
  options.signal?.throwIfAborted();
  if (!working.some((attachment) => attachment.remotePages?.length || attachment.pendingTextBatches?.length)) return working;
  if (!supabase) throw new Error("云端服务未配置，暂时无法读取长篇扫描 PDF。");
  const totals = working.map((attachment) => attachmentProgress(attachment));
  const total = totals.reduce((sum, value) => sum + value.total, 0);
  let completed = totals.reduce((sum, value) => sum + value.completed, 0);
  options.onProgress?.(completed, total);

  for (let attachmentIndex = 0; attachmentIndex < working.length; attachmentIndex += 1) {
    let attachment = working[attachmentIndex];
    let remaining = [...(attachment.remotePages ?? [])].sort((left, right) => left.pageNumber - right.pageNumber);
    let pendingTextBatches = [...(attachment.pendingTextBatches ?? [])].sort((left, right) => left.startPage - right.startPage);
    if (!remaining.length && !pendingTextBatches.length) continue;
    const progress = attachmentProgress(attachment);
    const textParts = progress.completed > 0 && attachment.text?.trim() ? [attachment.text.trim()] : [];
    let processedPageCount = progress.completed;
    let processingUsage = normalizeProcessingUsage(attachment.processingUsage);

    while (pendingTextBatches.length) {
      throwIfAborted(options.signal);
      const batch = pendingTextBatches[0];
      const { data, error } = await supabase.functions.invoke<{
        text?: string;
        usage?: Partial<AiAttachmentProcessingUsage>;
      }>("ai-assistant", {
        signal: options.signal,
        body: {
          action: "summarize_document_batch",
          accessCode: options.accessCode?.trim() || undefined,
          document: {
            name: attachment.name,
            pageCount: attachment.pageCount,
            startPage: batch.startPage,
            endPage: batch.endPage,
            text: batch.text,
            feature: options.feature ?? "assistant"
          }
        }
      });
      if (error || !data?.text?.trim()) {
        const reason = await functionErrorMessage(error, `PDF 第 ${batch.startPage}-${batch.endPage} 页整理失败。`);
        throw new Error(`PDF 已整理 ${processedPageCount}/${progress.total} 页；${reason} 已完成内容已保留，重试将从未完成页继续。`);
      }
      textParts.push(`第 ${batch.startPage}-${batch.endPage} 页：\n${data.text.trim()}`);
      processingUsage = combineProcessingUsage(processingUsage, normalizeProcessingUsage(data.usage));
      pendingTextBatches = pendingTextBatches.slice(1);
      const completedPages = batch.endPage - batch.startPage + 1;
      processedPageCount += completedPages;
      completed += completedPages;
      attachment = {
        ...attachment,
        text: textParts.join("\n\n").slice(0, 100_000),
        pendingTextBatches: pendingTextBatches.length ? pendingTextBatches : undefined,
        processedPageCount,
        processingUsage,
        notice: pendingTextBatches.length
          ? `文本型 PDF 已整理 ${processedPageCount}/${progress.total} 页`
          : `文本型 PDF 已完成 ${processedPageCount} 页整理`
      };
      working[attachmentIndex] = attachment;
      options.onProgress?.(completed, total);
      options.onUpdate?.(working.map(cloneAttachment));
    }

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
    pendingTextBatches: attachment.pendingTextBatches?.map((batch) => ({ ...batch })),
    pageImages: attachment.pageImages ? [...attachment.pageImages] : undefined,
    processingUsage: attachment.processingUsage ? { ...attachment.processingUsage } : undefined
  };
}

function attachmentProgress(attachment: AiAssistantAttachment): { completed: number; total: number } {
  const remaining = attachment.remotePages?.length ?? 0;
  const pendingTextPages = attachment.pendingTextBatches?.reduce((sum, batch) => sum + batch.endPage - batch.startPage + 1, 0) ?? 0;
  const hasExtractedText = Boolean(attachment.text?.trim()) && !/将由 AI 分批读取|将分 \d+ 批整理|已上传 \d+ 页/.test(attachment.text ?? "");
  const reported = hasExtractedText ? Math.max(0, Number(attachment.processedPageCount) || 0) : 0;
  return { completed: reported, total: reported + remaining + pendingTextPages };
}

function buildPdfTextBatches(pages: Array<{ pageNumber: number; text: string }>): AiDocumentTextBatch[] {
  const batches: AiDocumentTextBatch[] = [];
  let current: AiDocumentTextBatch | null = null;
  for (const page of pages) {
    const pageText = `第 ${page.pageNumber} 页：\n${page.text}`;
    if (current && current.text.length + pageText.length + 2 > PDF_TEXT_BATCH_CHARS) {
      batches.push(current);
      current = null;
    }
    if (!current) current = { startPage: page.pageNumber, endPage: page.pageNumber, text: pageText };
    else {
      current.endPage = page.pageNumber;
      current.text += `\n\n${pageText}`;
    }
  }
  if (current) batches.push(current);
  return batches;
}

async function configuredPdfPageLimit(accessCode?: string, signal?: AbortSignal): Promise<number> {
  if (!supabase) return DEFAULT_MAX_PDF_TOTAL_PAGES;
  try {
    const response = await supabase.functions.invoke<{ maxDocumentPages?: number }>("ai-assistant", {
      signal,
      body: { action: "configuration", accessCode: accessCode?.trim() || undefined }
    });
    const value = Number(response?.data?.maxDocumentPages);
    return !response?.error && Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_PDF_TOTAL_PAGES;
  } catch {
    throwIfAborted(signal);
    return DEFAULT_MAX_PDF_TOTAL_PAGES;
  }
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
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  }));
  // Do not let cleanup race a still-running worker that can recreate a deleted object.
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return output;
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

function readDataUrl(file: Blob, mimeType: string): Promise<string> {
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
