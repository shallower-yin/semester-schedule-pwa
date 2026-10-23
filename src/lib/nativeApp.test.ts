import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeAppHistory, navigateAppHistory, pushAppHistoryLayer } from "./appHistory";
import {
  consumePendingNativeNotificationKey,
  initializeNativeAppBridge,
  isNativeApp,
  NATIVE_NOTIFICATION_OPEN_EVENT
} from "./nativeApp";

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getLaunchUrl: vi.fn(),
  addListener: vi.fn(),
  minimizeApp: vi.fn(),
  listeners: new Map<string, (event: { url?: string; canGoBack?: boolean }) => void>()
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native.isNativePlatform } }));
vi.mock("@capacitor/app", () => ({ App: {
  getLaunchUrl: native.getLaunchUrl,
  addListener: native.addListener,
  minimizeApp: native.minimizeApp
} }));

describe("原生应用桥的通知路由与返回", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_TARGET__", "android");
    vi.clearAllMocks();
    native.listeners.clear();
    consumePendingNativeNotificationKey();
    native.isNativePlatform.mockReturnValue(true);
    native.getLaunchUrl.mockResolvedValue(undefined);
    native.minimizeApp.mockResolvedValue(undefined);
    native.addListener.mockImplementation(async (event, listener) => {
      native.listeners.set(event, listener);
      return { remove: async () => { native.listeners.delete(event); } };
    });
    window.history.replaceState(null, "");
  });

  afterEach(() => {
    consumePendingNativeNotificationKey();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "");
  });

  it("冷启动getLaunchUrl缓存通知key，React稍后只能消费一次", async () => {
    native.getLaunchUrl.mockResolvedValue({ url: "semesterschedule://notification?key=event%3Aevent-123%3A2026-10-23" });

    await initializeNativeAppBridge();

    expect(native.getLaunchUrl).toHaveBeenCalledOnce();
    expect(consumePendingNativeNotificationKey()).toBe("event:event-123:2026-10-23");
    expect(consumePendingNativeNotificationKey()).toBeNull();
    expect(native.listeners.has("appUrlOpen")).toBe(true);
    expect(native.listeners.has("backButton")).toBe(true);
  });

  it("暖启动appUrlOpen即时发送通知事件，同时保留一次pending消费", async () => {
    await initializeNativeAppBridge();
    const onOpen = vi.fn();
    window.addEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, onOpen);
    try {
      native.listeners.get("appUrlOpen")!({ url: "semesterschedule://notification?key=route%3Atodos" });
      expect(onOpen).toHaveBeenCalledOnce();
      expect((onOpen.mock.calls[0][0] as CustomEvent<string>).detail).toBe("route:todos");
      expect(consumePendingNativeNotificationKey()).toBe("route:todos");
      expect(consumePendingNativeNotificationKey()).toBeNull();
    } finally {
      window.removeEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, onOpen);
    }
  });

  it.each([
    "https://notification/?key=event%3Aforeign",
    "otherapp://notification?key=event%3Aforeign",
    "semesterschedule-evil://notification?key=event%3Aforeign",
    "semesterschedule://unknown?key=event%3Aforeign",
    "semesterschedule://notification?key=",
    "not a url"
  ])("拒绝外部或无效链接：%s", async (url) => {
    native.getLaunchUrl.mockResolvedValue({ url });
    const onOpen = vi.fn();
    window.addEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, onOpen);
    try {
      await initializeNativeAppBridge();
      native.listeners.get("appUrlOpen")!({ url });
      expect(onOpen).not.toHaveBeenCalled();
      expect(consumePendingNativeNotificationKey()).toBeNull();
    } finally {
      window.removeEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, onOpen);
    }
  });

  it.each(["cold", "warm"])("%s专注链接统一转换为focus路由", async (mode) => {
    if (mode === "cold") native.getLaunchUrl.mockResolvedValue({ url: "semesterschedule://focus" });
    await initializeNativeAppBridge();
    if (mode === "warm") native.listeners.get("appUrlOpen")!({ url: "semesterschedule://focus?source=timer" });
    expect(consumePendingNativeNotificationKey()).toBe("route:focus");
  });

  it.each(["today", "focus"] as const)("%s页有弹层时优先history.back，不能最小化", async (page) => {
    await initializeNativeAppBridge();
    initializeAppHistory(page);
    pushAppHistoryLayer("dialog-inner");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    native.listeners.get("backButton")!({ canGoBack: false });

    expect(back).toHaveBeenCalledOnce();
    expect(native.minimizeApp).not.toHaveBeenCalled();
  });

  it("非today页没有弹层也走应用历史返回", async () => {
    await initializeNativeAppBridge();
    initializeAppHistory("today");
    navigateAppHistory("focus");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    native.listeners.get("backButton")!({ canGoBack: false });
    expect(back).toHaveBeenCalledOnce();
    expect(native.minimizeApp).not.toHaveBeenCalled();
  });

  it("today无弹层时最小化应用，不按WebView的canGoBack退出应用页", async () => {
    await initializeNativeAppBridge();
    initializeAppHistory("today");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    native.listeners.get("backButton")!({ canGoBack: true });
    expect(native.minimizeApp).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });

  it.each(["launch", "listener"])("原生%s失败不会让初始化promise拒绝，Web启动可继续", async (stage) => {
    if (stage === "launch") native.getLaunchUrl.mockRejectedValueOnce(new Error("bridge unavailable"));
    else native.addListener.mockRejectedValueOnce(new Error("listener unavailable"));
    await expect(initializeNativeAppBridge()).resolves.toBeUndefined();
  });

  it.each([
    { target: "web", nativePlatform: true },
    { target: "android", nativePlatform: false }
  ])("非原生路径不访问插件：$target/$nativePlatform", async ({ target, nativePlatform }) => {
    vi.stubGlobal("__APP_TARGET__", target);
    native.isNativePlatform.mockReturnValue(nativePlatform);
    expect(isNativeApp()).toBe(false);
    await initializeNativeAppBridge();
    expect(native.getLaunchUrl).not.toHaveBeenCalled();
    expect(native.addListener).not.toHaveBeenCalled();
    expect(native.minimizeApp).not.toHaveBeenCalled();
  });
});
