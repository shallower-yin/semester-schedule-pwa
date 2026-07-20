import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGlobalShortcuts, type GlobalShortcutHandlers } from "./useGlobalShortcuts";

function makeHandlers(): GlobalShortcutHandlers {
  return {
    onSearch: vi.fn(),
    onNewToday: vi.fn(),
    onQuickEntry: vi.fn(),
    onScheduleAssistant: vi.fn(),
    onAssistant: vi.fn(),
    onMindMap: vi.fn(),
    onToday: vi.fn(),
    onEscape: vi.fn()
  };
}

function Probe({ handlers }: { handlers: GlobalShortcutHandlers }) {
  useGlobalShortcuts(handlers);
  return <input data-testid="field" />;
}

afterEach(cleanup);

describe("全局键盘快捷键", () => {
  it("按键映射到对应动作", () => {
    const handlers = makeHandlers();
    render(<Probe handlers={handlers} />);

    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(document.body, { key: "Q" });
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "d" });
    fireEvent.keyDown(document.body, { key: "M" });
    fireEvent.keyDown(document.body, { key: "t" });
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(handlers.onSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onNewToday).toHaveBeenCalledTimes(1);
    expect(handlers.onQuickEntry).toHaveBeenCalledTimes(1);
    expect(handlers.onScheduleAssistant).toHaveBeenCalledTimes(1);
    expect(handlers.onAssistant).toHaveBeenCalledTimes(1);
    expect(handlers.onMindMap).toHaveBeenCalledTimes(1);
    expect(handlers.onToday).toHaveBeenCalledTimes(1);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it("在输入框中输入时抑制快捷键，但 Escape 仍生效", () => {
    const handlers = makeHandlers();
    const { getByTestId } = render(<Probe handlers={handlers} />);
    const field = getByTestId("field");

    fireEvent.keyDown(field, { key: "n" });
    fireEvent.keyDown(field, { key: "/" });
    expect(handlers.onNewToday).not.toHaveBeenCalled();
    expect(handlers.onSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it("卸载后不再响应按键", () => {
    const handlers = makeHandlers();
    const { unmount } = render(<Probe handlers={handlers} />);
    unmount();

    fireEvent.keyDown(document.body, { key: "/" });
    expect(handlers.onSearch).not.toHaveBeenCalled();
  });
});
