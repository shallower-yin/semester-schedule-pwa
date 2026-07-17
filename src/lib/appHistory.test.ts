import { beforeEach, describe, expect, it } from "vitest";
import { appHistoryLayer, appHistoryPage, initializeAppHistory, navigateAppHistory, pushAppHistoryLayer } from "./appHistory";

describe("应用返回历史", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("记录页面切换供系统返回键逐页返回", () => {
    initializeAppHistory("today");
    navigateAppHistory("calendar");
    expect(appHistoryPage(window.history.state)).toBe("calendar");

    navigateAppHistory("memos");
    expect(appHistoryPage(window.history.state)).toBe("memos");
  });

  it("从弹窗进入新页面时消费当前弹窗层", () => {
    initializeAppHistory("today");
    pushAppHistoryLayer("modal-1");
    expect(appHistoryLayer(window.history.state)).toBe("modal-1");

    navigateAppHistory("calendar");
    expect(appHistoryLayer(window.history.state)).toBeNull();
    expect(appHistoryPage(window.history.state)).toBe("calendar");
  });
});
