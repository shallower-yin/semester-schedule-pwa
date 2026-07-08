import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HEADER_TOOLS, loadHeaderToolSettings, saveHeaderToolSettings } from "./headerToolSettings";

describe("顶部按钮设置", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("没有设置时使用默认五个工具", () => {
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
});
