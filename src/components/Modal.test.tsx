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

  it("挂载到 body、锁住页面滚动并在关闭后恢复焦点", async () => {
    const before = document.createElement("button");
    before.textContent = "打开前";
    document.body.appendChild(before);
    before.focus();
    const { unmount } = render(<Modal title="可访问弹窗" onClose={() => undefined}><button>弹窗操作</button></Modal>);

    const dialog = screen.getByRole("dialog", { name: "可访问弹窗" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(before).toHaveFocus();
    before.remove();
  });

  it("Tab 不会离开弹窗", async () => {
    render(
      <Modal title="焦点弹窗" onClose={() => undefined}>
        <button>第一个</button>
        <button>最后一个</button>
      </Modal>
    );
    const first = screen.getByRole("button", { name: "第一个" });
    const last = screen.getByRole("button", { name: "最后一个" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();

    screen.getByRole("button", { name: "关闭" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});
