import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusFullscreen, formatFocusDate } from "./FocusFullscreen";
import type { ActiveFocusState } from "../lib/focus";

vi.mock("../lib/nativeApp", () => ({ isNativeApp: () => true }));
vi.mock("../lib/focusOverlayPlugin", () => ({
  FocusOverlay: { setImmersive: vi.fn(), setOrientation: vi.fn() }
}));

function activeState(overrides: Partial<ActiveFocusState> = {}): ActiveFocusState {
  return {
    mode: "pomodoro",
    task_title: "复习高数",
    linked_event_id: null,
    planned_seconds: 1500,
    started_at: "2026-07-20T01:00:00.000Z",
    paused_seconds: 0,
    pause_started_at: null,
    ...overrides
  };
}

function renderFullscreen(props: Record<string, unknown> = {}) {
  const handlers = {
    onPauseResume: vi.fn(),
    onFinish: vi.fn(),
    onDiscard: vi.fn(),
    onExit: vi.fn(),
    onToggleSystemWindow: vi.fn()
  };
  render(
    <FocusFullscreen
      active={activeState()}
      displaySeconds={1490}
      progress={0.1}
      paused={false}
      now={new Date(2026, 6, 20, 10, 0, 0)}
      systemWindowOpen={false}
      systemWindowSupported
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("全屏专注", () => {
  afterEach(cleanup);

  it("显示倒计时、任务、日期星期与模式", () => {
    renderFullscreen();
    expect(screen.getByText("24:50")).toBeInTheDocument();
    expect(screen.getByText("复习高数")).toBeInTheDocument();
    expect(screen.getByText("番茄钟")).toBeInTheDocument();
    expect(screen.getByText("7月20日 星期一")).toBeInTheDocument();
  });

  it("按钮触发对应回调", () => {
    const handlers = renderFullscreen();
    fireEvent.click(screen.getByRole("button", { name: /结束并保存/ }));
    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    fireEvent.click(screen.getByRole("button", { name: /系统小窗/ }));
    expect(handlers.onFinish).toHaveBeenCalledTimes(1);
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSystemWindow).toHaveBeenCalledTimes(1);
  });

  it("暂停时显示已暂停并可继续", () => {
    const handlers = renderFullscreen({ paused: true });
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(handlers.onPauseResume).toHaveBeenCalledTimes(1);
  });

  it("不支持系统小窗时隐藏该按钮", () => {
    renderFullscreen({ systemWindowSupported: false });
    expect(screen.queryByRole("button", { name: /系统小窗/ })).not.toBeInTheDocument();
  });

  it("系统小窗已开启时显示关闭小窗", () => {
    renderFullscreen({ systemWindowOpen: true });
    expect(screen.getByRole("button", { name: /关闭小窗/ })).toBeInTheDocument();
  });

  it("安卓端显示横屏切换按钮", () => {
    renderFullscreen();
    expect(screen.getByRole("button", { name: /横屏/ })).toBeInTheDocument();
  });

  it("切换背景按钮更换背景图", () => {
    renderFullscreen();
    const surface = document.querySelector(".focus-fullscreen") as HTMLElement;
    const before = surface.style.backgroundImage;
    fireEvent.click(screen.getByRole("button", { name: "切换背景" }));
    expect(surface.style.backgroundImage).not.toBe(before);
  });

  it("formatFocusDate 输出月日与星期", () => {
    expect(formatFocusDate(new Date(2026, 6, 20))).toBe("7月20日 星期一");
  });
});
