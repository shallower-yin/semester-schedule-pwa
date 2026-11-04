import { PublicHttpError } from "./requestContext.ts";
import type { AiAssistantRequest } from "./requestTypes.ts";

// Client permits three 6MiB images (~24MiB base64) or three scanned PDFs
// with at most 7M inline chars each. Larger scans/audio use R2 references.
export const MAX_AI_BODY_BYTES = 32 * 1024 * 1024;
export const MAX_QUESTION_CHARS = 20_000;
const invalid = () => { throw new PublicHttpError("请求内容格式无效，请检查后重试。", 400); };
const large = () => { throw new PublicHttpError("请求内容超过限制（请求体最多 32 MiB），请缩短文本或使用分批上传。", 413); };

export async function readAiRequest(request: Request, byteLimit = MAX_AI_BODY_BYTES): Promise<AiAssistantRequest> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > byteLimit) { await request.body?.cancel(); large(); }
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "", depth = 0, quoted = false, escaped = false;
  try {
    while (true) {
      const chunk = await reader!.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > byteLimit) { await reader!.cancel(); large(); }
      const part = decoder.decode(chunk.value, { stream: true });
      for (const c of part) {
        if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === "{" || c === "[") { if (++depth > 64) { await reader!.cancel(); large(); } }
        else if (c === "}" || c === "]") depth--;
      }
      text += part;
    }
    text += decoder.decode();
  } catch (error) { if (error instanceof PublicHttpError) throw error; invalid(); }
  finally { reader!.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  for (const key of ["action", "mode", "question", "accessCode", "audioTranscript", "audioSubmissionId", "audioLanguage", "audioRangeSignature", "audioPartSignature"]) if (body[key] !== undefined && typeof body[key] !== "string") invalid();
  if (typeof body.question === "string" && body.question.length > MAX_QUESTION_CHARS) throw new PublicHttpError("单次问题最多 20,000 个字符。", 413);
  if (typeof body.audioTranscript === "string" && body.audioTranscript.length > 1_000_000) large();
  for (const key of ["audio", "audioRange", "audioPart", "audioSubmission", "document", "translation", "translationSummary", "mindMap"]) if (body[key] !== undefined && (!body[key] || typeof body[key] !== "object" || Array.isArray(body[key]))) invalid();
  for (const key of ["history", "attachments", "audios", "audioSegmentResults"]) if (body[key] !== undefined && !Array.isArray(body[key])) invalid();
  if (body.history) {
    const history = body.history as Array<{ role: string; content: string }>;
    if (history.length > 50) throw new PublicHttpError("历史消息最多 50 条。", 413);
    let total = 0;
    for (const row of history) {
      if (!row || typeof row !== "object" || !["user", "assistant"].includes(row.role) || typeof row.content !== "string") invalid();
      if (row.content.length > 20_000 || (total += row.content.length) > 100_000) throw new PublicHttpError("历史消息每条最多 20,000 个字符，合计最多 100,000 个字符。", 413);
    }
  }
  // Bound object/array work independently of string payload (large image/audio
  // strings are intentionally allowed by their existing feature validators).
  const objectArrays = new Set(["attachments", "audios", "audioSegmentResults", "pages", "remotePages", "items"]);
  const stringArrays = new Set(["pageImages", "objectKeys", "segments"]);
  const strings = new Set(["name", "fileName", "mimeType", "dataUrl", "objectKey", "text", "documentId", "feature", "language", "sourceText", "requiredTerms", "preservedTerms", "theme", "focus", "direction", "style"]);
  const numbers = new Set(["size", "pageNumber", "pageCount", "processedPageCount", "startPage", "endPage", "partIndex", "partCount", "chunkIndex", "chunkCount", "nominalStart", "nominalEnd", "fetchStart", "fetchEnd"]);
  const allNodes: unknown[] = [body]; let nodes = 0;
  while (allNodes.length) {
    if (++nodes > 100_000) large();
    const node = allNodes.pop();
    if (node && typeof node === "object") for (const child of Object.values(node)) allNodes.push(child);
  }
  const stack: unknown[] = [body];
  while (stack.length) {
    const node = stack.pop();
    if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) {
      if (key === "scheduleContext" || key === "mindMap") continue;
      if (key === "translation" && node !== body && typeof child !== "string") invalid();
      if (strings.has(key) && child !== undefined && typeof child !== "string") invalid();
      if (numbers.has(key) && child !== undefined && (typeof child !== "number" || !Number.isFinite(child))) invalid();
      if (objectArrays.has(key) && (!Array.isArray(child) || child.some(row => !row || typeof row !== "object" || Array.isArray(row)))) invalid();
      if (stringArrays.has(key) && (!Array.isArray(child) || child.some(row => typeof row !== "string"))) invalid();
      stack.push(child);
    }
  }
  return body as AiAssistantRequest;
}
