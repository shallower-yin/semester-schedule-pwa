import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { appHistoryLayer, initializeAppHistory } from "./appHistory";
import { useHistoryLayer } from "./useHistoryLayer";

afterEach(() => cleanup());

it("三层界面返回只关闭最上层，不关闭仍被遮挡的底层", async () => {
  window.history.replaceState({}, "", "/");
  initializeAppHistory("today");
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  renderHook(() => useHistoryLayer(true, callbacks[0], "first"));
  await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^first-/));
  renderHook(() => useHistoryLayer(true, callbacks[1], "second"));
  await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^second-/));
  const secondState = window.history.state;
  renderHook(() => useHistoryLayer(true, callbacks[2], "third"));
  await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^third-/));

  act(() => {
    window.history.replaceState(secondState, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: secondState }));
  });

  expect(callbacks[2]).toHaveBeenCalledTimes(1);
  expect(callbacks[1]).not.toHaveBeenCalled();
  expect(callbacks[0]).not.toHaveBeenCalled();
});
