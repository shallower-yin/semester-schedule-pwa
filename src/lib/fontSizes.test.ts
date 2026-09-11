import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_FONT_SIZES,
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
    expect(localStorage.getItem("semester-schedule-font-size-v2")).toBe("standard");
  });

  it("把旧版偏小字号迁移为新版标准字号并保持视觉大小", () => {
    localStorage.setItem("semester-schedule-font-size-v1", "compact");

    expect(loadAppFontSize()).toBe("standard");
    expect(localStorage.getItem("semester-schedule-font-size-v2")).toBe("standard");
  });

  it("用户在新版主动选择偏小后不会被迁移逻辑改回标准", () => {
    localStorage.setItem("semester-schedule-font-size-v1", "compact");
    localStorage.setItem("semester-schedule-font-size-v2", "compact");

    expect(loadAppFontSize()).toBe("compact");
  });

  it("新版设置有效时不会再读取旧版设置", () => {
    localStorage.setItem("semester-schedule-font-size-v2", "large");
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    expect(loadAppFontSize()).toBe("large");
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith("semester-schedule-font-size-v2");
  });

  it("站点存储读取受限时仍能使用标准字号启动", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    expect(loadAppFontSize()).toBe(DEFAULT_APP_FONT_SIZE);
  });

  it("迁移设置无法写入时仍返回正确字号", () => {
    localStorage.setItem("semester-schedule-font-size-v1", "compact");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    expect(loadAppFontSize()).toBe("standard");
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
    expect(document.documentElement.style.fontSize).toBe("14.08px");
    expect(document.documentElement.style.getPropertyValue("-webkit-text-size-adjust")).toBe("80%");
  });

  it("标准字号等于旧版偏小字号，四档整体下移", () => {
    expect(APP_FONT_SIZES.map((option) => option.scale)).toEqual([0.8, 0.88, 1, 1.12]);

    vi.spyOn(window, "getComputedStyle").mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);

    applyAppFontSize("compact");
    expect(document.documentElement.style.fontSize).toBe("12.8px");

    applyAppFontSize("standard");
    expect(document.documentElement.style.fontSize).toBe("14.08px");

    applyAppFontSize("large");
    expect(document.documentElement.style.fontSize).toBe("16px");

    applyAppFontSize("extra-large");
    expect(document.documentElement.style.fontSize).toBe("17.92px");
  });

  it("只调整根字号，不在运行时改写整个 CSSOM", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);

    applyAppFontSize("compact");

    expect(document.documentElement.style.fontSize).toBe("12.8px");

    applyAppFontSize("standard");
    expect(document.documentElement.style.fontSize).toBe("14.08px");
  });
});
