import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    await db.restSessions.clear();
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
    await waitFor(() => expect(db.focusSessions.count()).resolves.toBe(0));
    await waitFor(() => expect(screen.getByText("还没有专注记录。")).toBeInTheDocument());
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

  it("显示完整番茄循环设置并为旧设置补足轮数", async () => {
    await db.focusSettings.put({
      id: crypto.randomUUID(),
      user_id: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      version: 1,
      device_id: "device-1",
      pomodoro_minutes: 25,
      short_break_minutes: 5,
      long_break_minutes: 15,
      long_break_interval: 4,
      auto_start_break: true,
      countdown_minutes: 30,
      daily_goal_minutes: 120,
      sound_enabled: true
    } as never);
    render(<FocusPage ownerId="local" />);
    expect(await screen.findByLabelText("番茄个数")).toHaveValue(4);
    expect(screen.getByLabelText("短休息分钟")).toHaveValue(5);
    expect(screen.getByLabelText("长休息分钟")).toHaveValue(15);
    expect(screen.getByLabelText("长休息间隔")).toHaveValue(4);
    expect(screen.getByRole("checkbox", { name: /自动开始休息/ })).toBeChecked();
  });

  it("休息只写入休息记录，不计入专注记录", async () => {
    render(<FocusPage ownerId="local" />);
    fireEvent.click(await screen.findByRole("button", { name: "休息" }));
    fireEvent.click(screen.getByRole("button", { name: "开始休息" }));
    fireEvent.click(await screen.findByRole("button", { name: /结束并保存/ }));
    await waitFor(() => expect(db.restSessions.count()).resolves.toBe(1));
    expect(await db.focusSessions.count()).toBe(2);
    expect(await db.syncQueue.where("table_name").equals("restSessions").count()).toBe(1);
  });

  it("锁机层只显示正计时时钟和结束按钮", async () => {
    render(<FocusPage ownerId="local" />);
    fireEvent.click(await screen.findByRole("button", { name: "锁机" }));
    fireEvent.click(screen.getByRole("button", { name: "开始专注" }));
    const dialog = await screen.findByRole("dialog", { name: "锁机专注" });
    expect(within(dialog).getByLabelText(/已专注/)).toHaveTextContent(/^\d{2}:\d{2}(?::\d{2})?$/);
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "结束" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/暂停|放弃|任务|锁机专注模式/)).not.toBeInTheDocument();
  });
});
