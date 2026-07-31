import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AVAILABLE_MOBILE_NAV, DEFAULT_MOBILE_NAV, loadMobileNavSettings, saveMobileNavSettings } from "./mobileNavSettings";

const STORAGE_KEY = "semester-schedule-mobile-nav";
const responsiveStyles = readFileSync(resolve(process.cwd(), "src/styles/06-responsive.css"), "utf8");

describe("安卓底部导航设置", () => {
  beforeEach(() => localStorage.clear());

  it("首次打开默认显示所有可用按钮", () => {
    expect(DEFAULT_MOBILE_NAV).toEqual(AVAILABLE_MOBILE_NAV);
    expect(loadMobileNavSettings()).toEqual(AVAILABLE_MOBILE_NAV);
  });

  it("旧版默认设置自动补齐后来增加的按钮", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      "today", "calendar", "habits", "anniversaries", "memos", "focus", "health", "settings"
    ]));
    expect(loadMobileNavSettings()).toEqual(AVAILABLE_MOBILE_NAV);
  });

  it("保留用户主动选择的按钮和顺序", () => {
    expect(saveMobileNavSettings(["focus", "today", "health"])).toEqual(["focus", "today", "health"]);
    expect(loadMobileNavSettings()).toEqual(["focus", "today", "health"]);
  });

  it("安卓端按选择数量等分且不启用横向滚动", () => {
    expect(responsiveStyles).toMatch(
      /\.app-shell\[data-app-target="android"\] \.mobile-bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(var\(--mobile-nav-count\),\s*minmax\(0,\s*1fr\)\)[\s\S]*?overflow-x:\s*hidden/
    );
  });
});
