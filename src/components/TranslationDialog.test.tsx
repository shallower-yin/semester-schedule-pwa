import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeAppHistory } from "../lib/appHistory";
import { TranslationDialog } from "./TranslationDialog";

vi.mock("../lib/translation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/translation")>();
  return { ...original, translateText: vi.fn() };
});

beforeEach(() => {
  localStorage.clear();
  initializeAppHistory("today");
});

afterEach(cleanup);

describe("翻译助手工作台", () => {
  it("提供方向、风格、双栏编辑和本机历史说明", () => {
    render(<TranslationDialog ownerId="local" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "翻译助手" })).toBeInTheDocument();
    expect(screen.getByText("中译英")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("natural");
    expect(screen.getByRole("textbox", { name: "翻译原文" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "翻译译文" })).toBeInTheDocument();
    expect(screen.getByText("仅保存在当前设备")).toBeInTheDocument();
  });

  it("一键交换翻译方向", () => {
    render(<TranslationDialog ownerId="local" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "交换翻译方向" }));
    expect(screen.getByText("英译中")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "翻译原文" })).toHaveAttribute("placeholder", "Enter or paste English text");
  });
});
