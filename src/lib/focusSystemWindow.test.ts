import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveFocusState } from "./focus";

const mocks = vi.hoisted(() => ({
  isNativeApp: vi.fn(),
  overlay: {
    hasPermission: vi.fn(),
    requestPermission: vi.fn(),
    show: vi.fn(),
    update: vi.fn(),
    hide: vi.fn()
  },
  pip: {
    openFocusPictureInPicture: vi.fn(),
    updateFocusPictureInPicture: vi.fn(),
    closeFocusPictureInPicture: vi.fn(),
    focusPictureInPictureSupported: vi.fn()
  }
}));

vi.mock("./nativeApp", () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock("./focusOverlayPlugin", () => ({ FocusOverlay: mocks.overlay }));
vi.mock("./focusPictureInPicture", () => ({
  openFocusPictureInPicture: mocks.pip.openFocusPictureInPicture,
  updateFocusPictureInPicture: mocks.pip.updateFocusPictureInPicture,
  closeFocusPictureInPicture: mocks.pip.closeFocusPictureInPicture,
  focusPictureInPictureSupported: mocks.pip.focusPictureInPictureSupported
}));

function activeState(overrides: Partial<ActiveFocusState> = {}): ActiveFocusState {
  return {
    mode: "countdown",
    task_title: "复习",
    linked_event_id: null,
    planned_seconds: 1500,
    started_at: "2026-07-20T01:00:00.000Z",
    paused_seconds: 0,
    pause_started_at: null,
    ...overrides
  };
}

async function loadModule() {
  return import("./focusSystemWindow");
}

describe("专注系统窗口适配层", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.isNativeApp.mockReturnValue(false);
    mocks.overlay.hasPermission.mockResolvedValue({ granted: true });
    mocks.overlay.requestPermission.mockResolvedValue({ granted: true });
    mocks.overlay.show.mockResolvedValue(undefined);
    mocks.overlay.update.mockResolvedValue(undefined);
    mocks.overlay.hide.mockResolvedValue(undefined);
    mocks.pip.focusPictureInPictureSupported.mockReturnValue(true);
  });

  it("浏览器端沿用画中画，不触碰原生插件", async () => {
    const mod = await loadModule();
    const active = activeState();

    expect(mod.focusSystemWindowSupported()).toBe(true);
    expect(mocks.pip.focusPictureInPictureSupported).toHaveBeenCalled();

    await mod.openFocusSystemWindow(active, new Date(), true);
    mod.updateFocusSystemWindow(active);
    await mod.closeFocusSystemWindow();

    expect(mocks.pip.openFocusPictureInPicture).toHaveBeenCalledWith(active, expect.any(Date));
    expect(mocks.pip.updateFocusPictureInPicture).toHaveBeenCalledWith(active, expect.any(Date));
    expect(mocks.pip.closeFocusPictureInPicture).toHaveBeenCalled();
    expect(mocks.overlay.show).not.toHaveBeenCalled();
  });

  it("APK 端已授权时用计时锚点显示原生悬浮窗", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    const mod = await loadModule();

    await mod.openFocusSystemWindow(activeState(), new Date(), true);

    expect(mocks.overlay.requestPermission).not.toHaveBeenCalled();
    expect(mocks.overlay.show).toHaveBeenCalledTimes(1);
    expect(mocks.overlay.show).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: new Date("2026-07-20T01:00:00.000Z").getTime(),
        pausedSeconds: 0,
        pauseStartedAt: -1,
        plannedSeconds: 1500,
        label: "倒计时",
        title: "复习"
      })
    );
    expect(mocks.pip.openFocusPictureInPicture).not.toHaveBeenCalled();
  });

  it("APK 端暂停时上报暂停锚点并显示已暂停", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    const mod = await loadModule();

    await mod.openFocusSystemWindow(
      activeState({ pause_started_at: "2026-07-20T01:10:00.000Z" }),
      new Date(),
      true
    );

    expect(mocks.overlay.show).toHaveBeenCalledWith(
      expect.objectContaining({
        pauseStartedAt: new Date("2026-07-20T01:10:00.000Z").getTime(),
        label: "已暂停"
      })
    );
  });

  it("APK 端交互触发但用户拒绝授权时抛错", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    mocks.overlay.hasPermission.mockResolvedValue({ granted: false });
    mocks.overlay.requestPermission.mockResolvedValue({ granted: false });
    const mod = await loadModule();

    await expect(mod.openFocusSystemWindow(activeState(), new Date(), true)).rejects.toThrow(/权限/);
    expect(mocks.overlay.show).not.toHaveBeenCalled();
  });

  it("APK 端后台自动打开未授权时静默跳过，不打扰用户", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    mocks.overlay.hasPermission.mockResolvedValue({ granted: false });
    const mod = await loadModule();

    await expect(mod.openFocusSystemWindow(activeState(), new Date(), false)).resolves.toBeUndefined();
    expect(mocks.overlay.requestPermission).not.toHaveBeenCalled();
    expect(mocks.overlay.show).not.toHaveBeenCalled();
  });

  it("APK 端未打开小窗时不推送 update，打开后仅在锚点变化时推送", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    const mod = await loadModule();
    const active = activeState();

    mod.updateFocusSystemWindow(active);
    expect(mocks.overlay.update).not.toHaveBeenCalled();

    await mod.openFocusSystemWindow(active, new Date(), true);
    mod.updateFocusSystemWindow(active);
    expect(mocks.overlay.update).not.toHaveBeenCalled();

    mod.updateFocusSystemWindow(activeState({ pause_started_at: "2026-07-20T01:10:00.000Z" }));
    expect(mocks.overlay.update).toHaveBeenCalledTimes(1);
    expect(mocks.overlay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: new Date("2026-07-20T01:00:00.000Z").getTime(),
        pauseStartedAt: new Date("2026-07-20T01:10:00.000Z").getTime(),
        label: "已暂停"
      })
    );

    mod.updateFocusSystemWindow(activeState({
      pause_started_at: "2026-07-20T01:10:00.000Z",
      paused_seconds: 0
    }));
    expect(mocks.overlay.update).toHaveBeenCalledTimes(1);
  });

  it("APK 端重新打开小窗时再次携带完整计时锚点，不会省略 startedAt", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    const mod = await loadModule();
    const active = activeState({
      started_at: "2026-07-20T01:00:00.000Z",
      paused_seconds: 42,
      planned_seconds: 1500
    });

    await mod.openFocusSystemWindow(active, new Date(), true);
    await mod.closeFocusSystemWindow();
    await mod.openFocusSystemWindow(active, new Date(), true);

    expect(mocks.overlay.show).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startedAt: new Date("2026-07-20T01:00:00.000Z").getTime(),
        pausedSeconds: 42,
        plannedSeconds: 1500
      })
    );
  });

  it("APK 端关闭时隐藏原生悬浮窗", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    const mod = await loadModule();

    await mod.closeFocusSystemWindow();

    expect(mocks.overlay.hide).toHaveBeenCalledTimes(1);
    expect(mocks.pip.closeFocusPictureInPicture).not.toHaveBeenCalled();
  });
});
