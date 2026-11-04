import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScheduleWidgetBridge } from "./useScheduleWidgetBridge";

const bridge = vi.hoisted(() => ({
  native: vi.fn(), activate: vi.fn(), update: vi.fn(), consume: vi.fn(), snapshot: vi.fn()
}));
vi.mock("./nativeApp", () => ({ isNativeApp: bridge.native }));
vi.mock("./scheduleWidgetPlugin", () => ({ ScheduleWidget: {
  setActiveOwner: bridge.activate, updateSnapshot: bridge.update
} }));
vi.mock("./widgetCompletionActions", () => ({ consumePendingWidgetCompletionActions: bridge.consume }));
vi.mock("./widgetSnapshot", () => ({ buildWidgetSnapshot: bridge.snapshot }));

type Input = Parameters<typeof useScheduleWidgetBridge>[0];
function input(overrides: Partial<Input> = {}): Input {
  return {
    authReady: true, dataReady: true, ownerId: "alice", semester: null,
    courses: [], schedules: [], cancellations: [], events: [], categories: [],
    occurrenceStates: [], todos: [], periods: [], focusSessions: [], ...overrides
  };
}
async function settle() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.resetAllMocks();
  bridge.native.mockReturnValue(true);
  bridge.activate.mockResolvedValue({ accepted: true });
  bridge.update.mockResolvedValue({ accepted: true });
  bridge.consume.mockResolvedValue({ received: 0, applied: 0, acknowledged: 0 });
  bridge.snapshot.mockReturnValue({ schema: 1, days: [] });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("日程小组件生命周期", () => {
  it("网页端不访问原生桥", async () => {
    bridge.native.mockReturnValue(false);
    renderHook(() => useScheduleWidgetBridge(input()));
    await settle();
    expect(bridge.activate).not.toHaveBeenCalled();
    expect(bridge.update).not.toHaveBeenCalled();
    expect(bridge.consume).not.toHaveBeenCalled();
  });

  it("认证未完成不清空缓存，认证完成立即切账号，不等待慢查询", async () => {
    const props = input({ authReady: false, dataReady: false });
    const { rerender } = renderHook(useScheduleWidgetBridge, { initialProps: props });
    await settle();
    expect(bridge.activate).not.toHaveBeenCalled();
    rerender({ ...props, authReady: true });
    await settle();
    expect(bridge.activate).toHaveBeenCalledExactlyOnceWith({ ownerId: "alice" });
    expect(bridge.consume).toHaveBeenCalledExactlyOnceWith("alice");
    expect(bridge.snapshot).not.toHaveBeenCalled();
    rerender({ ...props, authReady: true, dataReady: true });
    await settle();
    expect(bridge.snapshot).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "alice", todos: props.todos }), expect.any(Date));
    expect(bridge.update).toHaveBeenCalledExactlyOnceWith({
      ownerId: "alice", snapshotJson: JSON.stringify({ schema: 1, days: [], ownerId: "alice" })
    });
    expect(bridge.consume).toHaveBeenCalledOnce();
  });

  it("切换账号后旧的异步激活不能消费动作或发布快照", async () => {
    let release!: (value: { accepted: boolean }) => void;
    const pending = new Promise<{ accepted: boolean }>((resolve) => { release = resolve; });
    bridge.activate.mockImplementation(({ ownerId }) => ownerId === "alice" ? pending : Promise.resolve({ accepted: true }));
    const props = input();
    const { rerender } = renderHook(useScheduleWidgetBridge, { initialProps: props });
    rerender({ ...props, ownerId: "bob" });
    await settle();
    await act(async () => { release({ accepted: true }); await pending; });
    expect(bridge.consume).toHaveBeenCalledExactlyOnceWith("bob");
    expect(bridge.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerId: "bob" }));
    expect(bridge.snapshot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerId: "bob" }), expect.any(Date));
  });

  it("返回前台时消费并刷新，后台事件不刷新，卸载移除监听", async () => {
    const { unmount } = renderHook(() => useScheduleWidgetBridge(input()));
    await settle();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    await settle();
    expect(bridge.update).toHaveBeenCalledOnce();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    act(() => window.dispatchEvent(new Event("pageshow")));
    await settle();
    expect(bridge.update).toHaveBeenCalledTimes(3);
    expect(bridge.consume).toHaveBeenCalledTimes(3);
    unmount();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    await settle();
    expect(bridge.activate).toHaveBeenCalledTimes(6);
  });

  it("卸载取消尚未完成的激活后续步骤", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    bridge.activate.mockReturnValue(pending);
    const { unmount } = renderHook(() => useScheduleWidgetBridge(input()));
    unmount();
    await act(async () => { release(); await pending; });
    expect(bridge.consume).not.toHaveBeenCalled();
    expect(bridge.update).not.toHaveBeenCalled();
  });

  it("不相关rerender不重新发布，当前账号数据变化才发布", async () => {
    const props = input();
    const { rerender } = renderHook(useScheduleWidgetBridge, { initialProps: props });
    await settle();
    rerender({ ...props });
    await settle();
    expect(bridge.update).toHaveBeenCalledOnce();
    rerender({ ...props, events: [...props.events] });
    await settle();
    expect(bridge.update).toHaveBeenCalledTimes(2);
    expect(bridge.consume).toHaveBeenCalledOnce();
  });

  it("旧壳不支持桥接时静默退出，前台仍可重试", async () => {
    bridge.activate.mockRejectedValue(new Error("not implemented"));
    renderHook(() => useScheduleWidgetBridge(input()));
    await settle();
    expect(bridge.update).not.toHaveBeenCalled();
    expect(bridge.consume).not.toHaveBeenCalled();
    bridge.activate.mockResolvedValue({ accepted: true });
    act(() => window.dispatchEvent(new Event("pageshow")));
    await settle();
    expect(bridge.update).toHaveBeenCalledOnce();
    expect(bridge.consume).toHaveBeenCalledOnce();
  });
});
