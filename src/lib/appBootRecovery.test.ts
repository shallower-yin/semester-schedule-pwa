import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAppCachesAndReload } from "./appBootRecovery";

function recoveryEnvironment(scope: string) {
  const ownWorker = { scope, unregister: vi.fn().mockResolvedValue(true) };
  const siblingWorker = { scope: "https://example.com/another-app/", unregister: vi.fn().mockResolvedValue(true) };
  const cacheNames = [
    `workbox-precache-v2-${scope}`,
    "semester-schedule-offline-updates",
    `semester-schedule-offline-updates-v2-${encodeURIComponent(new URL(scope).pathname)}`,
    "workbox-precache-v2-https://example.com/another-app/",
    "another-app-offline-data"
  ];
  const ownAsset = `${scope}assets/index-old.js`;
  const siblingAsset = "https://example.com/another-app/assets/index.js";
  const legacyCache = {
    keys: vi.fn().mockResolvedValue([{ url: ownAsset }, { url: siblingAsset }, { url: `${scope}api/account.json` }]),
    delete: vi.fn().mockResolvedValue(true)
  };
  const cacheStorage = {
    keys: vi.fn().mockResolvedValue(cacheNames),
    delete: vi.fn().mockResolvedValue(true),
    open: vi.fn().mockResolvedValue(legacyCache)
  };
  const location = {
    href: `${scope}?notification=event%3A123&code=auth-code#result`,
    pathname: new URL(scope).pathname,
    search: "?notification=event%3A123&code=auth-code",
    hash: "#result",
    replace: vi.fn(),
    reload: vi.fn()
  };
  const navigator = {
    serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([ownWorker, siblingWorker]) }
  };
  return { ownWorker, siblingWorker, cacheNames, cacheStorage, legacyCache, ownAsset, siblingAsset, location, navigator };
}

function loadInlineRecovery(base = "/schedule/", scope = "https://example.com/schedule/") {
  const env = recoveryEnvironment(scope);
  const bootWindow = Object.assign(new EventTarget(), {
    setTimeout: window.setTimeout.bind(window),
    caches: env.cacheStorage
  });
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error("Missing inline boot recovery");
  new Function("window", "document", "navigator", "sessionStorage", "location", "caches", source.replaceAll("%BASE_URL%", base))(
    bootWindow, document, env.navigator, sessionStorage, env.location, env.cacheStorage
  );
  return { ...env, bootWindow };
}

describe("启动恢复隔离与慢启动", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = '<div id="root">正在打开日程计划表…</div>';
    delete document.documentElement.dataset.appReady;
  });

  afterEach(async () => {
    // Disconnect the inline observer even when an assertion fails.
    document.documentElement.dataset.appReady = "true";
    await Promise.resolve();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.appReady;
  });

  it("慢启动完成后移除超时遮罩并重置恢复计数", async () => {
    sessionStorage.setItem("semester-schedule-boot-recover-count", "1");
    const { bootWindow } = loadInlineRecovery();
    bootWindow.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(document.getElementById("boot-recover-banner")).not.toBeNull();

    document.documentElement.dataset.appReady = "true";
    await Promise.resolve();

    expect(document.getElementById("boot-recover-banner")).toBeNull();
    expect(sessionStorage.getItem("semester-schedule-boot-recover-count")).toBeNull();
  });

  it.each([
    ["/", "https://example.com/"],
    ["/schedule/", "https://example.com/schedule/"],
    ["./", "https://example.com/schedule/"]
  ])("base %s 启动前恢复只清本scope条目并保留查询参数", async (base, scope) => {
    const env = loadInlineRecovery(base, scope);
    await vi.advanceTimersByTimeAsync(12_000);
    const clearButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "清缓存重载");
    expect(clearButton).toBeDefined();
    clearButton!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(env.ownWorker.unregister).toHaveBeenCalledOnce();
    expect(env.siblingWorker.unregister).not.toHaveBeenCalled();
    expect(env.cacheStorage.delete.mock.calls.map(([key]) => key)).toEqual([env.cacheNames[0]]);
    expect(env.legacyCache.delete.mock.calls.every(([request]) => request.url === env.ownAsset)).toBe(true);
    expect(env.legacyCache.delete).toHaveBeenCalled();
    const reloaded = new URL(env.location.replace.mock.calls[0][0], env.location.href);
    expect(reloaded.searchParams.get("notification")).toBe("event:123");
    expect(reloaded.searchParams.get("code")).toBe("auth-code");
    expect(reloaded.hash).toBe("#result");
    expect(reloaded.searchParams.has("recovered")).toBe(true);
  });

  it.each([
    ["/", "https://example.com/"],
    ["/schedule/", "https://example.com/schedule/"],
    ["./", "https://example.com/schedule/"]
  ])("base %s 应用内清缓存不注销同域其他应用或删除其离线数据", async (base, scope) => {
    vi.stubEnv("BASE_URL", base);
    const env = recoveryEnvironment(scope);
    vi.stubGlobal("window", { location: env.location, caches: env.cacheStorage });
    vi.stubGlobal("navigator", env.navigator);
    vi.stubGlobal("caches", env.cacheStorage);

    await clearAppCachesAndReload();

    expect(env.ownWorker.unregister).toHaveBeenCalledOnce();
    expect(env.siblingWorker.unregister).not.toHaveBeenCalled();
    expect(env.cacheStorage.delete.mock.calls.map(([key]) => key)).toEqual([env.cacheNames[0]]);
    expect(env.legacyCache.delete.mock.calls.every(([request]) => request.url === env.ownAsset)).toBe(true);
    expect(env.legacyCache.delete).toHaveBeenCalled();
    expect(env.location.replace).toHaveBeenCalledWith(expect.stringContaining("notification=event%3A123"));
  });
});
