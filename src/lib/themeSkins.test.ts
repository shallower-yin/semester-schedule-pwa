import { beforeEach, describe, expect, it } from "vitest";
import { applyDocumentThemeSkin, DEFAULT_THEME_SKIN, loadThemeSkin, saveThemeSkin, themeSkinColor, themeSkinLabel } from "./themeSkins";

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
    expect(themeSkinLabel("cake")).toBe("蛋糕物语");
  });

  it("把主题同步到弹窗祖先并在卸载时恢复", () => {
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    themeColor.content = "#3157d5";
    document.head.append(themeColor);
    document.documentElement.dataset.skin = "linen";
    const cleanup = applyDocumentThemeSkin("cake");
    expect(document.documentElement.dataset.skin).toBe("cake");
    expect(themeColor.content).toBe(themeSkinColor("cake"));
    cleanup();
    expect(document.documentElement.dataset.skin).toBe("linen");
    expect(themeColor.content).toBe("#3157d5");
  });

  it("网页没有主题色标签时创建并在卸载时清理", () => {
    const cleanup = applyDocumentThemeSkin("linen");

    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#477342");

    cleanup();
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
  });
});
