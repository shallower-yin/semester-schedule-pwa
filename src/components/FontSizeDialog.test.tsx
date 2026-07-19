import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeAppHistory } from "../lib/appHistory";
import { FontSizeDialog } from "./FontSizeDialog";

describe("字体大小弹窗", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    initializeAppHistory("settings");
  });

  afterEach(() => cleanup());

  it("选择字号时即时预览并可保存", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<FontSizeDialog value="standard" onChange={onChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole("radio", { name: /偏大/ }));
    expect(onChange).toHaveBeenLastCalledWith("large");
    expect(localStorage.getItem("semester-schedule-font-size-v1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存字号" }));
    expect(localStorage.getItem("semester-schedule-font-size-v1")).toBe("large");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("取消时恢复打开弹窗前的字号", () => {
    const onChange = vi.fn();
    render(<FontSizeDialog value="compact" onChange={onChange} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("radio", { name: /特大/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onChange).toHaveBeenLastCalledWith("compact");
    expect(localStorage.getItem("semester-schedule-font-size-v1")).toBeNull();
  });
});
