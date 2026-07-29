import { supabase } from "./supabase";

export type TranslationDirection = "zh-en" | "en-zh";
export type TranslationStyle = "natural" | "literal" | "academic" | "conversational";

export interface TranslationRequest {
  sourceText: string;
  direction: TranslationDirection;
  style: TranslationStyle;
  requiredTerms?: string;
  preservedTerms?: string;
  accessCode?: string;
  signal?: AbortSignal;
}

export interface TranslationResult {
  translation: string;
  access?: string;
  quota?: unknown;
}

export interface TranslationHistoryItem {
  id: string;
  sourceText: string;
  translation: string;
  direction: TranslationDirection;
  style: TranslationStyle;
  requiredTerms: string;
  preservedTerms: string;
  createdAt: string;
}

export const TRANSLATION_SOURCE_MAX_LENGTH = 20_000;
export const TRANSLATION_HISTORY_LIMIT = 30;

export const TRANSLATION_DIRECTION_LABELS: Record<TranslationDirection, string> = {
  "zh-en": "中译英",
  "en-zh": "英译中"
};

export const TRANSLATION_STYLE_LABELS: Record<TranslationStyle, string> = {
  natural: "自然",
  literal: "直译",
  academic: "正式学术",
  conversational: "简洁口语"
};

export async function translateText(input: TranslationRequest): Promise<TranslationResult> {
  const sourceText = input.sourceText.trim();
  if (!sourceText) throw new Error("请输入需要翻译的内容。");
  if (sourceText.length > TRANSLATION_SOURCE_MAX_LENGTH) {
    throw new Error(`首版单次最多翻译 ${TRANSLATION_SOURCE_MAX_LENGTH.toLocaleString("zh-CN")} 个字符。`);
  }
  if (!supabase) throw new Error("云端服务未配置，暂时无法使用翻译助手。");
  const { data, error } = await supabase.functions.invoke<TranslationResult>("ai-assistant", {
    signal: input.signal,
    body: {
      mode: "translation",
      question: sourceText,
      accessCode: input.accessCode?.trim() || undefined,
      translation: {
        direction: input.direction,
        style: input.style,
        requiredTerms: input.requiredTerms?.trim().slice(0, 2_000) || undefined,
        preservedTerms: input.preservedTerms?.trim().slice(0, 2_000) || undefined
      }
    }
  });
  if (error) throw new Error(await translationFunctionError(error));
  if (!data?.translation?.trim()) throw new Error("翻译模型没有返回有效译文。");
  return { ...data, translation: data.translation.trim() };
}

export function loadTranslationHistory(ownerId: string): TranslationHistoryItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(translationHistoryKey(ownerId)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isTranslationHistoryItem).slice(0, TRANSLATION_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function prependTranslationHistory(ownerId: string, item: TranslationHistoryItem): TranslationHistoryItem[] {
  const next = [item, ...loadTranslationHistory(ownerId).filter((existing) => existing.id !== item.id)]
    .slice(0, TRANSLATION_HISTORY_LIMIT);
  try {
    localStorage.setItem(translationHistoryKey(ownerId), JSON.stringify(next));
  } catch {
    // The completed translation is still returned even if this device is out of storage.
  }
  return next;
}

export function deleteTranslationHistoryItem(ownerId: string, id: string): TranslationHistoryItem[] {
  const next = loadTranslationHistory(ownerId).filter((item) => item.id !== id);
  try {
    localStorage.setItem(translationHistoryKey(ownerId), JSON.stringify(next));
  } catch {
    // Keep the current in-memory list usable when local storage is unavailable.
  }
  return next;
}

export function clearTranslationHistory(ownerId: string): void {
  localStorage.removeItem(translationHistoryKey(ownerId));
}

export function bilingualParagraphs(sourceText: string, translation: string): Array<{ source: string; translation: string }> {
  const source = splitParagraphs(sourceText);
  const target = splitParagraphs(translation);
  return Array.from({ length: Math.max(source.length, target.length) }, (_, index) => ({
    source: source[index] ?? "",
    translation: target[index] ?? ""
  })).filter((item) => item.source || item.translation);
}

function splitParagraphs(value: string): string[] {
  return value.trim().split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
}

function translationHistoryKey(ownerId: string): string {
  return `semester-schedule-translation-history-v1:${ownerId}`;
}

function isTranslationHistoryItem(value: unknown): value is TranslationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TranslationHistoryItem>;
  return typeof item.id === "string"
    && typeof item.sourceText === "string"
    && typeof item.translation === "string"
    && (item.direction === "zh-en" || item.direction === "en-zh")
    && (item.style === "natural" || item.style === "literal" || item.style === "academic" || item.style === "conversational")
    && typeof item.requiredTerms === "string"
    && typeof item.preservedTerms === "string"
    && typeof item.createdAt === "string";
}

async function translationFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "翻译失败，请稍后重试。";
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      // Fall through to the public fallback.
    }
  }
  return fallback.includes("non-2xx") ? "翻译失败，请稍后重试。" : fallback;
}
