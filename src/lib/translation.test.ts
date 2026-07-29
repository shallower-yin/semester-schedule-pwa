import { beforeEach, describe, expect, it } from "vitest";
import {
  bilingualParagraphs,
  clearTranslationHistory,
  deleteTranslationHistoryItem,
  loadTranslationHistory,
  prependTranslationHistory,
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
});
