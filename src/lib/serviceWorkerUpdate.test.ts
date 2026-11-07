import { afterEach, describe, expect, it, vi } from "vitest";
import { activateWaitingServiceWorker } from "./serviceWorkerUpdate";

describe("Service Worker 单次更新", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: originalServiceWorker });
    vi.restoreAllMocks();
  });

  it("已有 waiting worker 时一次发送跳过等待并等待接管", async () => {
    const worker = new EventTarget() as ServiceWorker;
    const registration = { waiting: worker, active: null, installing: null, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(worker, "postMessage", { value: vi.fn(() => {
      queueMicrotask(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
      setTimeout(() => {
        Object.defineProperty(registration, "active", { configurable: true, value: worker });
        navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
      }, 0);
    }) });
    const serviceWorker = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorker, "getRegistration", { value: vi.fn().mockResolvedValue(registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    await activateWaitingServiceWorker(100);
    expect(registration.update).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("一次动作先检查并等待安装完成，再激活新版本", async () => {
    const worker = new EventTarget() as ServiceWorker;
    let state: ServiceWorkerState = "installing";
    Object.defineProperty(worker, "state", { get: () => state });
    const registration = { waiting: null, active: null, installing: null, update: vi.fn(() => {
      Object.defineProperty(registration, "installing", { configurable: true, value: worker });
      setTimeout(() => {
        state = "installed";
        Object.defineProperty(registration, "waiting", { configurable: true, value: worker });
        worker.dispatchEvent(new Event("statechange"));
      }, 0);
      return Promise.resolve();
    }) } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(worker, "postMessage", { value: vi.fn(() => queueMicrotask(() => {
      Object.defineProperty(registration, "active", { configurable: true, value: worker });
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    })) });
    const serviceWorker = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorker, "getRegistration", { value: vi.fn().mockResolvedValue(registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    await activateWaitingServiceWorker(100);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("已有 installing worker 时不重复发起 update", async () => {
    const worker = new EventTarget() as ServiceWorker;
    let state: ServiceWorkerState = "installing";
    Object.defineProperty(worker, "state", { get: () => state });
    const registration = { waiting: null, active: null, installing: worker, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(worker, "postMessage", { value: vi.fn(() => queueMicrotask(() => {
      Object.defineProperty(registration, "active", { configurable: true, value: worker });
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    })) });
    const serviceWorker = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorker, "getRegistration", { value: vi.fn().mockResolvedValue(registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    queueMicrotask(() => {
      state = "installed";
      Object.defineProperty(registration, "waiting", { configurable: true, value: worker });
      worker.dispatchEvent(new Event("statechange"));
    });
    await activateWaitingServiceWorker(100);
    expect(registration.update).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("没有 waiting 或 installing worker 时返回明确错误", async () => {
    const registration = { waiting: null, installing: null, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    const serviceWorker = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorker, "getRegistration", { value: vi.fn().mockResolvedValue(registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    await expect(activateWaitingServiceWorker(100)).rejects.toThrow("新版本尚未开始安装");
  });

  it("接管超时或发送消息失败时清理 controllerchange 监听", async () => {
    const worker = new EventTarget() as ServiceWorker;
    Object.defineProperty(worker, "postMessage", { value: vi.fn(() => { throw new Error("发送失败"); }) });
    const registration = { waiting: worker, active: null, installing: null, update: vi.fn() } as unknown as ServiceWorkerRegistration;
    const serviceWorker = new EventTarget() as ServiceWorkerContainer;
    const removeEventListener = vi.spyOn(serviceWorker, "removeEventListener");
    Object.defineProperty(serviceWorker, "getRegistration", { value: vi.fn().mockResolvedValue(registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    await expect(activateWaitingServiceWorker(100)).rejects.toThrow("发送失败");
    expect(removeEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
  });
});
