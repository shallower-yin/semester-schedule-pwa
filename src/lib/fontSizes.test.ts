import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_FONT_SIZE,
  appFontSizeLabel,
  applyAppFontSize,
  loadAppFontSize,
  saveAppFontSize
} from "./fontSizes";

describe("字体大小设置", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-font-size");
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("没有设置时使用标准字号", () => {
    expect(loadAppFontSize()).toBe(DEFAULT_APP_FONT_SIZE);
  });

  it("保存并读取用户选择", () => {
    expect(saveAppFontSize("large")).toBe("large");
    expect(loadAppFontSize()).toBe("large");
    expect(appFontSizeLabel("large")).toBe("偏大");
  });

  it("自动抵消 WebView 的系统字体放大", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ fontSize: "20px" } as CSSStyleDeclaration);

    applyAppFontSize("standard");

    expect(document.documentElement.dataset.fontSize).toBe("standard");
    expect(document.documentElement.style.fontSize).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("-webkit-text-size-adjust")).toBe("80%");
  });

  it("在桌面浏览器中同步缩放样式表里的固定字号", () => {
    const styleElement = document.createElement("style");
    styleElement.textContent = ".font-size-test-rule { font-size: 20px; }";
    document.head.append(styleElement);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);

    applyAppFontSize("compact");

    const rule = styleElement.sheet?.cssRules[0] as CSSStyleRule;
    expect(document.documentElement.style.fontSize).toBe("14.08px");
    expect(rule.style.getPropertyValue("font-size")).toBe("17.6px");

    applyAppFontSize("standard");
    expect(rule.style.getPropertyValue("font-size")).toBe("20px");
    styleElement.remove();
  });
});
