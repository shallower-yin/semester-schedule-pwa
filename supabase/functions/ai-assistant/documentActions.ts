import { jsonResponse, PublicHttpError, type AiAccessCheck, type AiRequestContext, type AiUsageLogInput } from "./requestContext.ts";
import type {
  AiAssistantAttachment, AiAssistantRequest, AiAssistantUsage, AiFeatureKey, AiProvider,
  AiQuotaCheck, AiSettingsRow, ProviderCredentials, SupabaseUser
} from "./requestTypes.ts";

interface DocumentTextBatch {
  name: string;
  pageCount: number;
  startPage: number;
  endPage: number;
  text: string;
}

interface DocumentProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  endpoint: string;
  signal?: AbortSignal;
}

interface DocumentServices {
  checkAiAccess(user: SupabaseUser, authorization: string, accessCode: string | undefined, settings: AiSettingsRow | null, feature: AiFeatureKey): Promise<AiAccessCheck>;
  checkAiQuota(userId: string, method: string, key: string, settings: AiSettingsRow | null, feature: AiFeatureKey, diagnosticId: string, stage: string): Promise<AiQuotaCheck>;
  configuredProvider(settings: AiSettingsRow | null): AiProvider;
  configuredModel(settings: AiSettingsRow | null): string;
  configuredProviderCredentials(provider: AiProvider, settings: AiSettingsRow | null): Promise<ProviderCredentials>;
  modelSupportsAttachments(provider: AiProvider, model: string): boolean;
  createR2DocumentPageUploads(userId: string, value: AiAssistantRequest["document"]): Promise<unknown>;
  deleteR2DocumentPageObjects(userId: string, value: unknown): Promise<void>;
  sanitizeAttachments(value: unknown, allowed: boolean, userId: string): AiAssistantAttachment[];
  extractRemoteDocumentBatch(name: string, pages: NonNullable<AiAssistantAttachment["remotePages"]>, config: DocumentProviderConfig): Promise<{ text: string; usage: AiAssistantUsage }>;
  sanitizeDocumentTextBatch(value: AiAssistantRequest["document"]): DocumentTextBatch;
  summarizeDocumentTextBatch(batch: DocumentTextBatch, config: DocumentProviderConfig): Promise<{ text: string; usage: AiAssistantUsage }>;
  logAiAssistantUsage(input: AiUsageLogInput): Promise<void>;
}

/** Document uploads, extraction and summaries share one feature-admission boundary. */
export async function handleDocumentAction(context: AiRequestContext, services: DocumentServices): Promise<Response | null> {
  const { request, body, user, authorization, serviceRoleKey, settings, state } = context;
  // Cleanup deliberately needs only the authenticated owner, not remaining AI access/quota.
  if (body.action === "delete_document_uploads") {
    await services.deleteR2DocumentPageObjects(user.id, body.document?.objectKeys);
    return jsonResponse({ ok: true });
  }
  if (body.action !== "create_document_page_uploads" && body.action !== "extract_document_batch" && body.action !== "summarize_document_batch") return null;

  state.featureKey = body.document?.feature === "mind_map" ? "mind_map" : "assistant";
  const access = await services.checkAiAccess(user, authorization, body.accessCode?.trim(), settings, state.featureKey);
  if (!access.allowed) return jsonResponse({ error: access.reason, code: "AI_ACCESS_REQUIRED" }, 403);
  state.accessMethod = access.method ?? "";
  if (body.action === "create_document_page_uploads") {
    return jsonResponse(await services.createR2DocumentPageUploads(user.id, body.document));
  }

  const extracting = body.action === "extract_document_batch";
  const provider = services.configuredProvider(settings);
  const model = services.configuredModel(settings);
  let document: AiAssistantAttachment | undefined;
  let batch: DocumentTextBatch | undefined;
  try {
    if (extracting) {
      document = services.sanitizeAttachments(body.attachments, services.modelSupportsAttachments(provider, model), user.id).find(a => a.kind === "document" && a.remotePages?.length);
      if (!document || !document.remotePages?.length || document.remotePages.length > 6) throw new Error("扫描 PDF 分批参数无效，请重新选择文件。");
    } else batch = services.sanitizeDocumentTextBatch(body.document);
  } catch (error) { throw new PublicHttpError(error instanceof Error ? error.message : "文档参数无效。", 400); }
  const quota = await services.checkAiQuota(user.id, state.accessMethod, serviceRoleKey, settings, state.featureKey,
    state.diagnosticId, extracting ? "document_extract" : "document_summarize");
  if (!quota.allowed) return jsonResponse({ error: quota.reason, code: "AI_QUOTA_EXCEEDED" }, 429);
  const credentials = await services.configuredProviderCredentials(provider, settings);
  if (!credentials.apiKey) throw new Error(extracting ? "扫描 PDF 读取服务暂未配置。" : "长文档整理服务暂未配置。");
  const config = { provider, model, apiKey: credentials.apiKey, endpoint: credentials.endpoint, signal: request.signal };

  if (extracting) {
    const pages = document?.remotePages ?? [];
    if (!document || !pages.length || pages.length > 6) throw new Error("扫描 PDF 分批参数无效，请重新选择文件。");
    const result = await services.extractRemoteDocumentBatch(document.name ?? "未命名 PDF", pages, config);
    state.observedUsage = result.usage;
    await services.logAiAssistantUsage({
      userId: user.id, status: "success", accessMethod: state.accessMethod, featureKey: state.featureKey,
      model, usage: result.usage, latencyMs: Date.now() - state.startedAt, questionChars: 0,
      diagnosticId: state.diagnosticId, diagnosticDetails: { stage: "document_extract", processedPageCount: pages.length }
    });
    await services.deleteR2DocumentPageObjects(user.id, pages.map((page) => page.objectKey!)).catch((error) => {
      console.error("Failed to delete extracted PDF pages", { diagnosticId: state.diagnosticId, error: String(error) });
    });
    return jsonResponse({ text: result.text, usage: result.usage, processedPageCount: pages.length, model });
  }

  const result = await services.summarizeDocumentTextBatch(batch!, config);
  state.observedUsage = result.usage;
  await services.logAiAssistantUsage({
    userId: user.id, status: "success", accessMethod: state.accessMethod, featureKey: state.featureKey,
    model, usage: result.usage, latencyMs: Date.now() - state.startedAt, questionChars: batch!.text.length,
    diagnosticId: state.diagnosticId, diagnosticDetails: { stage: "document_summarize", startPage: batch!.startPage, endPage: batch!.endPage }
  });
  return jsonResponse({ text: result.text, usage: result.usage, processedPageCount: batch!.endPage - batch!.startPage + 1, model });
}
