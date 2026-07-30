import { supabase } from "./supabase";

export type TranslationDirection = "zh-en" | "en-zh";
export type TranslationStyle = "natural" | "literal" | "academic" | "conversational";
export type TranslationSummaryFocus = "comprehensive" | "sentence_patterns" | "vocabulary";

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

export interface TranslationSummarySample {
  sourceText: string;
  translation: string;
  direction: TranslationDirection;
}

export interface TranslationLearningTheme {
  name: string;
  summary: string;
}

export interface TranslationSentencePattern {
  pattern: string;
  meaning: string;
  example: string;
}

export interface TranslationVocabularyItem {
  term: string;
  meaning: string;
  usage: string;
  example: string;
}

export interface TranslationLearningSummary {
  title: string;
  overview: string;
  themes: TranslationLearningTheme[];
  sentencePatterns: TranslationSentencePattern[];
  vocabulary: TranslationVocabularyItem[];
  practice: string[];
  sampleCount: number;
  focus: TranslationSummaryFocus;
  theme: string;
  createdAt: string;
}

export interface TranslationSummaryRequest {
  history: TranslationHistoryItem[];
  focus: TranslationSummaryFocus;
  theme?: string;
  accessCode?: string;
  signal?: AbortSignal;
}

interface TranslationSummaryResult {
  summary: Omit<TranslationLearningSummary, "createdAt">;
  access?: string;
  quota?: unknown;
}

export const TRANSLATION_SOURCE_MAX_LENGTH = 20_000;
export const TRANSLATION_HISTORY_LIMIT = 100;
export const TRANSLATION_SUMMARY_MIN_HISTORY = 3;
export const TRANSLATION_SUMMARY_SAMPLE_TEXT_LIMIT = 200;
export const TRANSLATION_SUMMARY_THEME_MAX_LENGTH = 40;

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

export const TRANSLATION_SUMMARY_FOCUS_LABELS: Record<TranslationSummaryFocus, string> = {
  comprehensive: "综合复盘",
  sentence_patterns: "常用句式",
  vocabulary: "词汇搭配"
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

export async function summarizeTranslationHistory(input: TranslationSummaryRequest): Promise<TranslationLearningSummary> {
  const samples = buildTranslationSummarySamples(input.history);
  if (samples.length < TRANSLATION_SUMMARY_MIN_HISTORY) {
    throw new Error(`至少需要 ${TRANSLATION_SUMMARY_MIN_HISTORY} 条翻译记录才能生成学习总结。`);
  }
  if (!supabase) throw new Error("云端服务未配置，暂时无法生成学习总结。");
  const theme = input.theme?.trim().slice(0, TRANSLATION_SUMMARY_THEME_MAX_LENGTH) ?? "";
  const { data, error } = await supabase.functions.invoke<TranslationSummaryResult>("ai-assistant", {
    signal: input.signal,
    body: {
      mode: "translation_summary",
      accessCode: input.accessCode?.trim() || undefined,
      translationSummary: {
        focus: input.focus,
        theme: theme || undefined,
        items: samples
      }
    }
  });
  if (error) throw new Error(await translationFunctionError(error));
  if (!data?.summary || !isTranslationLearningSummary({ ...data.summary, createdAt: new Date().toISOString() })) {
    throw new Error("学习总结返回的数据不完整，请重试。");
  }
  return {
    ...data.summary,
    focus: input.focus,
    theme,
    sampleCount: samples.length,
    createdAt: new Date().toISOString()
  };
}

export function buildTranslationSummarySamples(history: TranslationHistoryItem[]): TranslationSummarySample[] {
  return history
    .slice(0, TRANSLATION_HISTORY_LIMIT)
    .map((item) => ({
      sourceText: compactSummaryText(item.sourceText),
      translation: compactSummaryText(item.translation),
      direction: item.direction
    }))
    .filter((item) => item.sourceText && item.translation);
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
  localStorage.removeItem(translationSummaryKey(ownerId));
}

export function loadTranslationLearningSummary(ownerId: string): TranslationLearningSummary | null {
  try {
    const value = JSON.parse(localStorage.getItem(translationSummaryKey(ownerId)) ?? "null") as unknown;
    return isTranslationLearningSummary(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveTranslationLearningSummary(ownerId: string, summary: TranslationLearningSummary): void {
  try {
    localStorage.setItem(translationSummaryKey(ownerId), JSON.stringify(summary));
  } catch {
    // The generated summary remains visible even if local storage is unavailable.
  }
}

export function clearTranslationLearningSummary(ownerId: string): void {
  localStorage.removeItem(translationSummaryKey(ownerId));
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

function translationSummaryKey(ownerId: string): string {
  return `semester-schedule-translation-learning-summary-v1:${ownerId}`;
}

function compactSummaryText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= TRANSLATION_SUMMARY_SAMPLE_TEXT_LIMIT) return compact;
  return `${compact.slice(0, TRANSLATION_SUMMARY_SAMPLE_TEXT_LIMIT - 1).trimEnd()}…`;
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

function isTranslationLearningSummary(value: unknown): value is TranslationLearningSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<TranslationLearningSummary>;
  return typeof summary.title === "string"
    && typeof summary.overview === "string"
    && Array.isArray(summary.themes)
    && summary.themes.every((item) => item && typeof item.name === "string" && typeof item.summary === "string")
    && Array.isArray(summary.sentencePatterns)
    && summary.sentencePatterns.every((item) => item
      && typeof item.pattern === "string"
      && typeof item.meaning === "string"
      && typeof item.example === "string")
    && Array.isArray(summary.vocabulary)
    && summary.vocabulary.every((item) => item
      && typeof item.term === "string"
      && typeof item.meaning === "string"
      && typeof item.usage === "string"
      && typeof item.example === "string")
    && Array.isArray(summary.practice)
    && summary.practice.every((item) => typeof item === "string")
    && Number.isFinite(summary.sampleCount)
    && (summary.focus === "comprehensive" || summary.focus === "sentence_patterns" || summary.focus === "vocabulary")
    && typeof summary.theme === "string"
    && typeof summary.createdAt === "string";
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
  if (/failed to send a request to the edge function|failed to fetch|fetch failed|networkerror/i.test(fallback)) {
    return "无法连接 AI 服务，请检查网络或 VPN 后重试；若其他 AI 功能也失败，请稍后再试。";
  }
  return fallback.includes("non-2xx") ? "翻译失败，请稍后重试。" : fallback;
}
