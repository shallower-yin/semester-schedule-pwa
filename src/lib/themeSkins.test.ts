import { beforeEach, describe, expect, it } from "vitest";
import { applyDocumentThemeSkin, DEFAULT_THEME_SKIN, loadThemeSkin, saveThemeSkin, THEME_SKINS, themeSkinColor, themeSkinLabel } from "./themeSkins";

describe("界面皮肤设置", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-skin");
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it("没有设置时使用默认皮肤", () => {
    expect(loadThemeSkin()).toBe(DEFAULT_THEME_SKIN);
  });

  it("保存并读取用户选择的皮肤", () => {
    expect(saveThemeSkin("cake")).toBe("cake");
    expect(loadThemeSkin()).toBe("cake");
    expect(themeSkinLabel("cake")).toBe("奶杏橙");
  });

  it("保留已有六种皮肤ID，并默认使用晴空蓝", () => {
    expect(THEME_SKINS.map((skin) => skin.id)).toEqual(["default", "cake", "linen", "space", "cherry", "peace"]);
    expect(themeSkinLabel(DEFAULT_THEME_SKIN)).toBe("晴空蓝");
    for (const skin of THEME_SKINS) {
      localStorage.setItem("semester-schedule-theme-skin", skin.id);
      expect(loadThemeSkin()).toBe(skin.id);
    }
  });

  it.each(THEME_SKINS)("$name 的共享导出色保留深色强调、浅背景和浅表面", (skin) => {
    const [accent, canvas, surface] = skin.colors.map(luminance);
    expect(canvas).toBeGreaterThan(0.85);
    expect(surface).toBeGreaterThan(0.95);
    expect((surface + 0.05) / (accent + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(skin.themeColor).toBe(skin.colors[1]);
  });

  it("把主题同步到弹窗祖先并在卸载时恢复", () => {
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    themeColor.content = "#eef7ff";
    document.head.append(themeColor);
    document.documentElement.dataset.skin = "linen";
    const cleanup = applyDocumentThemeSkin("cake");
    expect(document.documentElement.dataset.skin).toBe("cake");
    expect(themeColor.content).toBe(themeSkinColor("cake"));
    cleanup();
    expect(document.documentElement.dataset.skin).toBe("linen");
    expect(themeColor.content).toBe("#eef7ff");
  });

  it("网页没有主题色标签时创建并在卸载时清理", () => {
    const cleanup = applyDocumentThemeSkin("linen");

    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#effbf6");

    cleanup();
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
