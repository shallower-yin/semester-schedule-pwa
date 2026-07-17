import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HEADER_TOOLS, loadHeaderToolSettings, saveHeaderToolSettings } from "./headerToolSettings";

describe("顶部按钮设置", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("没有设置时使用默认工具", () => {
    expect(loadHeaderToolSettings()).toEqual(DEFAULT_HEADER_TOOLS);
  });

  it("允许保存为空，表示顶部不显示工具", () => {
    expect(saveHeaderToolSettings([])).toEqual([]);
    expect(loadHeaderToolSettings()).toEqual([]);
  });

  it("过滤无效工具并去重", () => {
    localStorage.setItem("semester-schedule-header-tools", JSON.stringify(["search", "bad", "search", "aiAssistant"]));
    expect(loadHeaderToolSettings()).toEqual(["search", "aiAssistant"]);
  });

  it("把旧版默认工具顺序升级为包含思维导图的新默认值", () => {
    localStorage.setItem("semester-schedule-header-tools", JSON.stringify(["account", "scheduleAssistant", "aiAssistant", "quickEntry", "search"]));
    expect(loadHeaderToolSettings()).toEqual(DEFAULT_HEADER_TOOLS);
  });

  it("把上一版默认工具顺序升级为包含音频转写的新默认值", () => {
    localStorage.setItem("semester-schedule-header-tools", JSON.stringify(["account", "scheduleAssistant", "aiAssistant", "mindMap", "quickEntry", "search"]));
    expect(loadHeaderToolSettings()).toEqual(DEFAULT_HEADER_TOOLS);
  });
});
