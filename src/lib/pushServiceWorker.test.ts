import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type WorkerListener = (event: {
  notification: {
    close: () => void;
    data?: { url?: string };
  };
  waitUntil: (operation: Promise<unknown>) => void;
}) => void;

function loadNotificationClickListener(scope = "https://example.com/semester-schedule-pwa/") {
  const listeners = new Map<string, WorkerListener>();
  const openWindow = vi.fn();
  const matchAll = vi.fn().mockResolvedValue([]);
  const worker = {
    registration: { scope },
    clients: { openWindow, matchAll },
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener)
  };
  const source = readFileSync(resolve(process.cwd(), "public/push-sw.js"), "utf8");
  new Function("self", source)(worker);
  return {
    listener: listeners.get("notificationclick")!,
    openWindow,
    matchAll
  };
}

describe("通知点击跳转", () => {
  it("手机端应用已在后台时优先聚焦现有 PWA 窗口", async () => {
    const { listener, openWindow, matchAll } = loadNotificationClickListener();
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    matchAll.mockResolvedValue([{ url: "https://example.com/semester-schedule-pwa/", focus, navigate }]);
    let completion: Promise<unknown> | undefined;

    listener({
      notification: {
        close: vi.fn(),
        data: { url: "https://example.com/semester-schedule-pwa/" }
      },
      waitUntil: (operation) => {
        completion = operation;
      }
    });
    await completion;

    expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(openWindow).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("应用未运行时通过通知地址启动已安装的 PWA", async () => {
    const { listener, openWindow } = loadNotificationClickListener();
    const focus = vi.fn().mockResolvedValue(undefined);
    openWindow.mockResolvedValue({ focus });
    let completion: Promise<unknown> | undefined;

    listener({
      notification: {
        close: vi.fn(),
        data: { url: "https://example.com/semester-schedule-pwa/" }
      },
      waitUntil: (operation) => {
        completion = operation;
      }
    });
    await completion;

    expect(openWindow).toHaveBeenCalledWith("https://example.com/semester-schedule-pwa/");
    expect(focus).toHaveBeenCalledOnce();
  });

  it("忽略超出应用作用域的通知地址", async () => {
    const { listener, openWindow } = loadNotificationClickListener();
    openWindow.mockResolvedValue(null);
    let completion: Promise<unknown> | undefined;

    listener({
      notification: {
        close: vi.fn(),
        data: { url: "https://invalid.example/" }
      },
      waitUntil: (operation) => {
        completion = operation;
      }
    });
    await completion;

    expect(openWindow).toHaveBeenCalledWith("https://example.com/semester-schedule-pwa/");
  });
});
