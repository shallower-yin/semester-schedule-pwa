import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_SKIN, loadThemeSkin, saveThemeSkin, themeSkinLabel } from "./themeSkins";

describe("界面皮肤设置", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("没有设置时使用默认皮肤", () => {
    expect(loadThemeSkin()).toBe(DEFAULT_THEME_SKIN);
  });

  it("保存并读取用户选择的皮肤", () => {
    expect(saveThemeSkin("cake")).toBe("cake");
    expect(loadThemeSkin()).toBe("cake");
    expect(themeSkinLabel("cake")).toBe("蛋糕物语");
  });
});
