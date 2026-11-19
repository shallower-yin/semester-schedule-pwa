import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Anniversary, Course, EventItem, TodoItem } from "../types";
import { NATIVE_NOTIFICATION_OPEN_EVENT } from "./nativeApp";
import { useNotificationNavigation } from "./useNotificationNavigation";
import { AI_TASK_OPEN_EVENT } from "./aiBackgroundTasks";

const bridge = vi.hoisted(() => ({ pending: vi.fn(), unwinding: vi.fn(), toast: vi.fn() }));
vi.mock("./nativeApp", () => ({
  consumePendingNativeNotificationKey: bridge.pending,
  NATIVE_NOTIFICATION_OPEN_EVENT: "semester-schedule-native-notification-open"
}));
vi.mock("./appHistory", async (importOriginal) => ({
  ...await importOriginal<typeof import("./appHistory")>(),
  isAppHistoryUnwinding: bridge.unwinding
}));
vi.mock("./toast", () => ({ showToast: bridge.toast }));

type Input = Parameters<typeof useNotificationNavigation>[0];
function input(overrides: Partial<Input> = {}): Input {
  return { ownerId: "alice", authReady: true, events: [], anniversaries: [], todos: [], courses: [], ...overrides };
}
function actions() {
  return {
    navigate: vi.fn(), goToday: vi.fn(), openQuickEntry: vi.fn(), createTodo: vi.fn(),
    openEvent: vi.fn(), openAnniversary: vi.fn(), openTodo: vi.fn(), openCourse: vi.fn(), openAiTask: vi.fn()
  };
}
function notify(key: string) {
  act(() => { window.dispatchEvent(new CustomEvent(NATIVE_NOTIFICATION_OPEN_EVENT, { detail: key })); });
}

beforeEach(() => {
  vi.resetAllMocks();
  bridge.pending.mockReturnValue(null);
  bridge.unwinding.mockReturnValue(false);
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("通知导航生命周期", () => {
  it("课程通知等待课程查询并打开当前账号的对应课程", () => {
    window.history.replaceState(null, "", "/?notification=course:course-1:schedule-1:2026-11-19");
    const callbacks = actions();
    const props = input({ authReady: false, courses: undefined });
    const { rerender } = renderHook((value) => useNotificationNavigation(value, callbacks), { initialProps: props });
    expect(callbacks.openCourse).not.toHaveBeenCalled();
    const course = { id: "course-1", user_id: "alice", deleted_at: null } as Course;
    rerender(input({ courses: [course] }));
    expect(callbacks.navigate).toHaveBeenCalledWith("calendar");
    expect(callbacks.openCourse).toHaveBeenCalledExactlyOnceWith(course);
    rerender(input({ courses: [course] }));
    expect(callbacks.openCourse).toHaveBeenCalledOnce();
  });

  it("课程通知不打开其他账号或已删除的课程", () => {
    const callbacks = actions();
    renderHook(() => useNotificationNavigation(input({ courses: [{ id: "course-1", user_id: "bob" } as Course] }), callbacks));
    notify("course:course-1:schedule-1:2026-11-19");
    expect(callbacks.openCourse).not.toHaveBeenCalled();
    expect(bridge.toast).toHaveBeenCalledWith("这条提醒对应的课程已被删除。", "info");
  });

  it("脑图通知冷启动等待账号恢复，使用新账号回调并且只打开一次", () => {
    window.history.replaceState({ page: "today" }, "", "/schedule/?ai=mind_map&keep=1#result");
    const local = actions();
    const signedIn = actions();
    const { rerender } = renderHook(({ data, callbacks }) => useNotificationNavigation(data, callbacks), {
      initialProps: { data: input({ ownerId: "local", authReady: false }), callbacks: local }
    });
    expect(local.openAiTask).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#result");
    expect(window.history.state).toEqual({ page: "today" });
    rerender({ data: input({ ownerId: "alice" }), callbacks: signedIn });
    expect(signedIn.openAiTask).toHaveBeenCalledExactlyOnceWith("mind_map");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    rerender({ data: input({ ownerId: "alice" }), callbacks: signedIn });
    expect(signedIn.openAiTask).toHaveBeenCalledOnce();
  });

  it("处理后台服务发来的脑图通知并在卸载后移除监听", () => {
    const worker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
    try {
      const callbacks = actions();
      const { unmount } = renderHook(() => useNotificationNavigation(input(), callbacks));
      act(() => worker.dispatchEvent(new MessageEvent("message", { data: { type: "ai-task-open", feature: "mind_map" } })));
      expect(callbacks.openAiTask).toHaveBeenCalledExactlyOnceWith("mind_map");
      act(() => worker.dispatchEvent(new MessageEvent("message", { data: { type: "ai-task-open", feature: "invalid" } })));
      expect(callbacks.openAiTask).toHaveBeenCalledOnce();
      unmount();
      act(() => worker.dispatchEvent(new MessageEvent("message", { data: { type: "ai-task-open", feature: "mind_map" } })));
      expect(callbacks.openAiTask).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("应用内任务入口继续打开对应功能", () => {
    const callbacks = actions();
    renderHook(() => useNotificationNavigation(input(), callbacks));
    act(() => window.dispatchEvent(new CustomEvent(AI_TASK_OPEN_EVENT, { detail: { feature: "mind_map" } })));
    expect(callbacks.openAiTask).toHaveBeenCalledExactlyOnceWith("mind_map");
  });

  it.each([
    ["route:today", "today"], ["route:todos", "todos"], ["route:focus", "focus"], ["health", "health"]
  ])("%s 无需等账号查询即可跳转，且冷启动仅消费一次", (key, page) => {
    bridge.pending.mockReturnValueOnce(key);
    const callbacks = actions();
    const props = input({ authReady: false });
    const { rerender } = renderHook((value) => useNotificationNavigation(value, callbacks), { initialProps: props });
    expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith(page);
    expect(callbacks.goToday).toHaveBeenCalledTimes(page === "today" ? 1 : 0);
    rerender({ ...props, authReady: true });
    expect(callbacks.navigate).toHaveBeenCalledTimes(1);
  });

  it.each(["route:quick-entry", "route:todos-create"])("%s 等认证就绪后才允许创建", (key) => {
    const callbacks = actions();
    const props = input({ authReady: false });
    const { rerender } = renderHook((value) => useNotificationNavigation(value, callbacks), { initialProps: props });
    notify(key);
    expect(callbacks.openQuickEntry).not.toHaveBeenCalled();
    expect(callbacks.createTodo).not.toHaveBeenCalled();
    rerender({ ...props, authReady: true });
    if (key === "route:quick-entry") expect(callbacks.openQuickEntry).toHaveBeenCalledOnce();
    else {
      expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith("todos");
      expect(callbacks.createTodo).toHaveBeenCalledOnce();
    }
  });

  it.each(["event", "habit"] as const)("事项查询就绪后打开 %s，数据重刷不重复打开", (eventType) => {
    const target = { id: "event-1", user_id: "alice", event_type: eventType } as EventItem;
    const callbacks = actions();
    const { rerender } = renderHook((value) => useNotificationNavigation(value, callbacks), {
      initialProps: input({ events: undefined })
    });
    notify("event:event-1:2026-11-04");
    expect(callbacks.navigate).not.toHaveBeenCalled();
    expect(bridge.toast).not.toHaveBeenCalled();
    rerender(input({ events: [target] }));
    expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith(eventType === "habit" ? "habits" : "calendar");
    expect(callbacks.openEvent).toHaveBeenCalledExactlyOnceWith(target);
    rerender(input({ events: [target] }));
    expect(callbacks.openEvent).toHaveBeenCalledOnce();
  });

  it("等数据期间切换账号，不打开旧账号记录且使用最新回调", () => {
    const previous = actions();
    const current = actions();
    const { rerender } = renderHook(({ data, callbacks }) => useNotificationNavigation(data, callbacks), {
      initialProps: { data: input({ events: undefined }), callbacks: previous }
    });
    notify("event:private:2026-11-04");
    rerender({ data: input({ ownerId: "bob", events: undefined }), callbacks: current });
    expect(current.navigate).not.toHaveBeenCalled();
    rerender({
      data: input({ ownerId: "bob", events: [{ id: "private", user_id: "alice" } as EventItem] }),
      callbacks: current
    });
    expect(previous.navigate).not.toHaveBeenCalled();
    expect(current.openEvent).not.toHaveBeenCalled();
    expect(current.navigate).toHaveBeenCalledExactlyOnceWith("calendar");
    expect(bridge.toast).toHaveBeenCalledExactlyOnceWith("这条提醒对应的事项已被删除。", "info");
  });

  it.each(["anniversary", "todo"] as const)("%s 等数据就绪并定位当前账号记录", (kind) => {
    const callbacks = actions();
    const { rerender } = renderHook((value) => useNotificationNavigation(value, callbacks), {
      initialProps: input({ anniversaries: undefined, todos: undefined })
    });
    notify(kind === "todo" ? "todo:target" : "anniversary:target:2026-11-04");
    expect(callbacks.navigate).not.toHaveBeenCalled();
    rerender(input({
      anniversaries: [{ id: "target", user_id: "alice" } as Anniversary],
      todos: [{ id: "target", user_id: "alice" } as TodoItem]
    }));
    expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith(kind === "todo" ? "todos" : "anniversaries");
    expect(kind === "todo" ? callbacks.openTodo : callbacks.openAnniversary).toHaveBeenCalledExactlyOnceWith("target");
  });

  it.each(["anniversary", "todo"] as const)("%s 不会打开其他账号同名ID", (kind) => {
    const callbacks = actions();
    renderHook(() => useNotificationNavigation(input({
      anniversaries: [{ id: "target", user_id: "bob" } as Anniversary],
      todos: [{ id: "target", user_id: "bob" } as TodoItem]
    }), callbacks));
    notify(kind === "todo" ? "todo:target" : "anniversary:target:2026-11-04");
    expect(callbacks.openTodo).not.toHaveBeenCalled();
    expect(callbacks.openAnniversary).not.toHaveBeenCalled();
    expect(bridge.toast).toHaveBeenCalledExactlyOnceWith(
      kind === "todo" ? "这条提醒对应的待办已被删除。" : "这条提醒对应的日子已被删除。", "info"
    );
    expect(callbacks.navigate).toHaveBeenCalledTimes(kind === "todo" ? 1 : 0);
  });

  it("浏览器通知参数只消费一次，保留其他参数、hash和历史状态", () => {
    const callbacks = actions();
    const state = { page: "today", layer: "test" };
    window.history.replaceState(state, "", "/?notification=route%3Afocus&keep=1#section");
    renderHook(() => useNotificationNavigation(input(), callbacks));
    expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith("focus");
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#section");
    expect(window.history.state).toEqual(state);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(callbacks.navigate).toHaveBeenCalledOnce();
  });

  it("历史层正在回退时不消费通知，正常popstate后再处理", () => {
    bridge.unwinding.mockReturnValue(true);
    window.history.replaceState(null, "", "/?notification=route%3Atodos");
    const callbacks = actions();
    renderHook(() => useNotificationNavigation(input(), callbacks));
    expect(callbacks.navigate).not.toHaveBeenCalled();
    expect(window.location.search).toContain("notification");
    bridge.unwinding.mockReturnValue(false);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(callbacks.navigate).toHaveBeenCalledExactlyOnceWith("todos");
  });

  it("未知通知不触发导航，卸载后移除原生与浏览器监听", () => {
    const callbacks = actions();
    const { unmount } = renderHook(() => useNotificationNavigation(input(), callbacks));
    notify("unknown");
    expect(callbacks.navigate).not.toHaveBeenCalled();
    unmount();
    notify("route:focus");
    window.history.replaceState(null, "", "/?notification=route%3Atodos");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(callbacks.navigate).not.toHaveBeenCalled();
    expect(window.location.search).toContain("notification");
  });
});
