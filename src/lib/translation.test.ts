import { beforeEach, describe, expect, it } from "vitest";
import {
  TRANSLATION_HISTORY_LIMIT,
  TRANSLATION_SUMMARY_SAMPLE_TEXT_LIMIT,
  bilingualParagraphs,
  buildTranslationSummarySamples,
  clearTranslationHistory,
  deleteTranslationHistoryItem,
  loadTranslationLearningSummary,
  loadTranslationHistory,
  prependTranslationHistory,
  saveTranslationLearningSummary,
  type TranslationLearningSummary,
  type TranslationHistoryItem
} from "./translation";

const first: TranslationHistoryItem = {
  id: "one",
  sourceText: "你好",
  translation: "Hello",
  direction: "zh-en",
  style: "natural",
  requiredTerms: "",
  preservedTerms: "OpenAI",
  createdAt: "2026-07-29T00:00:00.000Z"
};

const summary: TranslationLearningSummary = {
  title: "日常口语复盘",
  overview: "你最近主要练习了问候和安排。",
  themes: [{ name: "日常沟通", summary: "问候和确认安排" }],
  sentencePatterns: [{ pattern: "Could you [事情]?", meaning: "礼貌提出请求", example: "Could you send it today?" }],
  vocabulary: [{ term: "follow up", meaning: "跟进", usage: "follow up on + 事情", example: "I will follow up on it." }],
  practice: ["用今天的安排替换句式槽位并朗读三遍。"],
  sampleCount: 3,
  focus: "comprehensive",
  theme: "",
  createdAt: "2026-07-31T00:00:00.000Z"
};

describe("翻译助手本机数据", () => {
  beforeEach(() => localStorage.clear());

  it("保存、单条删除和全部删除历史", () => {
    expect(prependTranslationHistory("local", first)).toEqual([first]);
    expect(loadTranslationHistory("local")).toEqual([first]);
    expect(deleteTranslationHistoryItem("local", first.id)).toEqual([]);
    prependTranslationHistory("local", first);
    clearTranslationHistory("local");
    expect(loadTranslationHistory("local")).toEqual([]);
  });

  it("按空行对齐中英段落", () => {
    expect(bilingualParagraphs("第一段\n\n第二段", "First\n\nSecond")).toEqual([
      { source: "第一段", translation: "First" },
      { source: "第二段", translation: "Second" }
    ]);
  });

  it("最多保留最近 100 条翻译记录", () => {
    for (let index = 0; index < TRANSLATION_HISTORY_LIMIT + 5; index += 1) {
      prependTranslationHistory("local", {
        ...first,
        id: `item-${index}`,
        sourceText: `原文 ${index}`,
        translation: `Translation ${index}`
      });
    }
    const history = loadTranslationHistory("local");
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe("item-104");
    expect(history.at(-1)?.id).toBe("item-5");
  });

  it("为学习总结保留最多 100 条精简中英样本", () => {
    const longText = `  ${"word ".repeat(80)}  `;
    const history = Array.from({ length: 105 }, (_, index): TranslationHistoryItem => ({
      ...first,
      id: `sample-${index}`,
      sourceText: longText,
      translation: `Translation ${index}`
    }));
    const samples = buildTranslationSummarySamples(history);
    expect(samples).toHaveLength(100);
    expect(samples[0].sourceText.length).toBeLessThanOrEqual(TRANSLATION_SUMMARY_SAMPLE_TEXT_LIMIT);
    expect(samples[0].sourceText).not.toMatch(/\s{2,}/);
  });

  it("学习总结仅保存在本机，清空历史时一并删除", () => {
    saveTranslationLearningSummary("local", summary);
    expect(loadTranslationLearningSummary("local")).toEqual(summary);
    clearTranslationHistory("local");
    expect(loadTranslationLearningSummary("local")).toBeNull();
  });
});
