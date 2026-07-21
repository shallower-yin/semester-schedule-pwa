import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setCurrentUserId } from "../lib/identity";
import type { FocusSession } from "../types";
import { FocusPage } from "./FocusPage";
import { openFocusSystemWindow } from "../lib/focusSystemWindow";

vi.mock("../lib/focusSystemWindow", () => ({
  closeFocusSystemWindow: vi.fn(),
  focusSystemWindowSupported: () => true,
  openFocusSystemWindow: vi.fn(),
  updateFocusSystemWindow: vi.fn()
}));

vi.mock("./FocusAudioPlayer", () => ({
  FocusAudioPlayer: () => <div data-testid="focus-audio-player" />
}));

function session(id: string): FocusSession {
  return {
    id,
    user_id: "local",
    created_at: "2026-07-15T10:00:00.000Z",
    updated_at: "2026-07-15T10:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    mode: "pomodoro",
    task_title: `任务${id}`,
    linked_event_id: null,
    planned_seconds: 1500,
    duration_seconds: 1200,
    started_at: "2026-07-15T09:40:00.000Z",
    ended_at: `2026-07-15T10:00:0${id}.000Z`,
    completed: true,
    interrupted: false
  };
}

describe("专注记录管理", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.focusSessions.clear();
    await db.focusSettings.clear();
    await db.events.clear();
    await db.syncQueue.clear();
    await db.focusSessions.bulkPut([session("1"), session("2")]);
  });

  afterEach(cleanup);

  it("支持进入管理模式、全选并批量删除", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FocusPage ownerId="local" />);
    const manageButton = await screen.findByRole("button", { name: "管理记录" });
    await waitFor(() => expect(manageButton).toBeEnabled());
    fireEvent.click(manageButton);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "删除所选（2）" }));
    await waitFor(() => expect(screen.getByText("还没有专注记录。")).toBeInTheDocument());
    expect(await db.focusSessions.count()).toBe(0);
    expect(await db.syncQueue.where("table_name").equals("focusSessions").count()).toBe(2);
  });

  it("开始专注不自动弹出系统小窗，仅点击“系统小窗”后才打开", async () => {
    vi.mocked(openFocusSystemWindow).mockClear();
    render(<FocusPage ownerId="local" />);
    const startButton = await screen.findByRole("button", { name: /开始专注/ });
    fireEvent.click(startButton);
    await screen.findByRole("button", { name: /结束并保存/ });
    // 回归点：开始专注不得自动打开系统小窗（此前会在开始时自动弹出）。
    expect(openFocusSystemWindow).not.toHaveBeenCalled();
    // 只有点击“系统小窗”才交互式打开。
    fireEvent.click(screen.getByRole("button", { name: /系统小窗/ }));
    await waitFor(() => expect(openFocusSystemWindow).toHaveBeenCalledTimes(1));
    expect(openFocusSystemWindow).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "pomodoro" }),
      expect.any(Date),
      true
    );
  });
});
