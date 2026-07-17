import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appHistoryLayer, initializeAppHistory } from "../lib/appHistory";
import { Modal } from "./Modal";

describe("弹窗返回历史", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    initializeAppHistory("today");
  });

  afterEach(() => cleanup());

  it("手机系统返回事件只关闭当前弹窗", async () => {
    const onClose = vi.fn();
    render(<Modal title="测试弹窗" onClose={onClose}>内容</Modal>);
    await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^modal-/));

    const state = { __semesterSchedule: { page: "today" } };
    window.history.replaceState(state, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("弹窗关闭按钮消费当前历史层", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<Modal title="测试弹窗" onClose={() => undefined}>内容</Modal>);
    await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^modal-/));

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
