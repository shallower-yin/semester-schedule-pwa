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
    localStorage.setItem("semester-schedule-header-tools-v2", JSON.stringify(["search", "bad", "search", "aiAssistant"]));
    expect(loadHeaderToolSettings()).toEqual(["search", "aiAssistant"]);
  });

  it("保留原有顶部工具默认顺序", () => {
    localStorage.setItem("semester-schedule-header-tools", JSON.stringify(["account", "scheduleAssistant", "aiAssistant", "quickEntry", "search"]));
    expect(loadHeaderToolSettings()).toEqual(DEFAULT_HEADER_TOOLS);
  });

  it("旧设置迁移时保持手机端默认不显示脑图和音频入口", () => {
    localStorage.setItem("semester-schedule-header-tools", JSON.stringify(["account", "scheduleAssistant", "aiAssistant", "mindMap", "audioTranscription", "quickEntry", "search"]));
    expect(loadHeaderToolSettings()).toEqual(DEFAULT_HEADER_TOOLS);
  });

  it("允许用户主动勾选脑图和音频入口", () => {
    expect(saveHeaderToolSettings(["account", "mindMap", "audioTranscription"])).toEqual(["account", "mindMap", "audioTranscription"]);
    expect(loadHeaderToolSettings()).toEqual(["account", "mindMap", "audioTranscription"]);
  });
});
