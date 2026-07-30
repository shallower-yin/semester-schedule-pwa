import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissAiTask } from "../lib/aiBackgroundTasks";
import { initializeAppHistory } from "../lib/appHistory";
import {
  prependTranslationHistory,
  summarizeTranslationHistory,
  type TranslationHistoryItem,
  type TranslationLearningSummary
} from "../lib/translation";
import { TranslationDialog } from "./TranslationDialog";

vi.mock("../lib/translation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/translation")>();
  return { ...original, translateText: vi.fn(), summarizeTranslationHistory: vi.fn() };
});

beforeEach(() => {
  localStorage.clear();
  dismissAiTask("translation");
  vi.mocked(summarizeTranslationHistory).mockReset();
  initializeAppHistory("today");
});

afterEach(() => {
  dismissAiTask("translation");
  cleanup();
});

describe("翻译助手工作台", () => {
  it("提供方向、风格、双栏编辑和本机历史说明", () => {
    render(<TranslationDialog ownerId="local" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "翻译助手" })).toBeInTheDocument();
    expect(screen.getByText("中译英")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "翻译风格" })).toHaveValue("natural");
    expect(screen.getByRole("textbox", { name: "翻译原文" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "翻译译文" })).toBeInTheDocument();
    expect(screen.getByText(/仅保存在当前设备/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "学习总结重点" })).toHaveValue("comprehensive");
    expect(screen.getByRole("button", { name: "生成总结" })).toBeDisabled();
    expect(screen.getByText("完成翻译后，最近 100 条记录会保存在这台设备。")).toBeInTheDocument();
  });

  it("一键交换翻译方向", () => {
    render(<TranslationDialog ownerId="local" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "交换翻译方向" }));
    expect(screen.getByText("英译中")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "翻译原文" })).toHaveAttribute("placeholder", "Enter or paste English text");
  });

  it("可按主题生成并在本机展示学习总结", async () => {
    const historyItem: TranslationHistoryItem = {
      id: "history",
      sourceText: "你今天有空吗？",
      translation: "Are you free today?",
      direction: "zh-en",
      style: "conversational",
      requiredTerms: "",
      preservedTerms: "",
      createdAt: "2026-07-31T00:00:00.000Z"
    };
    for (let index = 0; index < 3; index += 1) {
      prependTranslationHistory("local", { ...historyItem, id: `history-${index}` });
    }
    const summary: TranslationLearningSummary = {
      title: "日常沟通口语复盘",
      overview: "你最近练习了询问时间与安排。",
      themes: [{ name: "日常沟通", summary: "询问对方是否方便" }],
      sentencePatterns: [{ pattern: "Are you free [时间]?", meaning: "询问对方某时是否有空", example: "Are you free tomorrow?" }],
      vocabulary: [{ term: "be free", meaning: "有空", usage: "be free + 时间", example: "I am free after class." }],
      practice: ["替换三个时间词并朗读。"],
      sampleCount: 3,
      focus: "sentence_patterns",
      theme: "日常沟通",
      createdAt: "2026-07-31T01:00:00.000Z"
    };
    vi.mocked(summarizeTranslationHistory).mockResolvedValue(summary);

    render(<TranslationDialog ownerId="local" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "学习总结重点" }), { target: { value: "sentence_patterns" } });
    fireEvent.change(screen.getByRole("textbox", { name: "限定主题（可选）" }), { target: { value: "日常沟通" } });
    fireEvent.click(screen.getByRole("button", { name: "生成总结" }));

    expect(await screen.findByText("日常沟通口语复盘")).toBeInTheDocument();
    expect(screen.getByText("Are you free [时间]?")).toBeInTheDocument();
    expect(summarizeTranslationHistory).toHaveBeenCalledWith(expect.objectContaining({
      focus: "sentence_patterns",
      theme: "日常沟通",
      history: expect.arrayContaining([expect.objectContaining({ id: "history-0" })])
    }));
  });
});
