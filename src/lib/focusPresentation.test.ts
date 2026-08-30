import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeFocusSystemWindow: vi.fn(async () => {}),
  setImmersive: vi.fn(async () => {}),
  setOrientation: vi.fn(async () => {})
}));

vi.mock("./focusSystemWindow", () => ({ closeFocusSystemWindow: mocks.closeFocusSystemWindow }));
vi.mock("./nativeApp", () => ({ isNativeApp: () => true }));
vi.mock("./focusOverlayPlugin", () => ({
  FocusOverlay: {
    setImmersive: mocks.setImmersive,
    setOrientation: mocks.setOrientation
  }
}));

import { resetAccountFocusPresentation } from "./focusPresentation";

describe("账号切换时的专注界面清理", () => {
  beforeEach(() => vi.clearAllMocks());

  it("同时关闭系统小窗、沉浸模式和方向锁", async () => {
    await resetAccountFocusPresentation();
    expect(mocks.closeFocusSystemWindow).toHaveBeenCalledTimes(1);
    expect(mocks.setImmersive).toHaveBeenCalledWith({ enabled: "false" });
    expect(mocks.setOrientation).toHaveBeenCalledWith({ mode: "auto" });
  });
});
