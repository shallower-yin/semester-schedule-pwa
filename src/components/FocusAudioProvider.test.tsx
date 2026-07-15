import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listFocusAudioTracks } from "../lib/focusAudio";
import { FocusAudioPlayer } from "./FocusAudioPlayer";
import { FocusAudioProvider, useFocusAudio } from "./FocusAudioProvider";

vi.mock("../lib/focusAudio", () => ({
  focusAudioPublicUrl: (path: string) => `https://audio.test/${path}`,
  listFocusAudioTracks: vi.fn()
}));

const TRACKS = [
    { id: "noise-1", title: "雨声", kind: "white_noise", storage_path: "rain.mp3", enabled: true, sort_order: 1 },
    { id: "music-1", title: "音乐一", kind: "music", storage_path: "music-1.mp3", enabled: true, sort_order: 2 },
    { id: "music-2", title: "音乐二", kind: "music", storage_path: "music-2.mp3", enabled: true, sort_order: 3 }
] as Awaited<ReturnType<typeof listFocusAudioTracks>>;

vi.mock("../lib/focusPictureInPicture", () => ({
  FOCUS_PICTURE_IN_PICTURE_MUTE_EVENT: "focus-picture-in-picture-audio-mute",
  setFocusPictureInPictureAudioMuted: vi.fn()
}));

const pausedState = new WeakMap<HTMLMediaElement, boolean>();

function AudioHarness() {
  const [showPlayer, setShowPlayer] = React.useState(true);
  const audio = useFocusAudio();
  return (
    <>
      <button onClick={() => setShowPlayer((current) => !current)}>{showPlayer ? "离开专注页" : "返回专注页"}</button>
      <output data-testid="playback-state">{audio.playing ? "播放中" : "已暂停"}</output>
      {showPlayer && <FocusAudioPlayer />}
    </>
  );
}

describe("全局专注音频", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listFocusAudioTracks).mockResolvedValue(TRACKS);
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function () {
      return pausedState.get(this) ?? true;
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function () {
      pausedState.set(this, true);
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
      pausedState.set(this, false);
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function () {
      pausedState.set(this, true);
      this.dispatchEvent(new Event("pause"));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("离开专注页后保持播放，并响应系统小窗静音", async () => {
    render(<FocusAudioProvider><AudioHarness /></FocusAudioProvider>);
    await screen.findByRole("combobox", { name: "选择专注音频" });
    fireEvent.click(screen.getByRole("button", { name: "播放音频" }));
    await waitFor(() => expect(screen.getByTestId("playback-state")).toHaveTextContent("播放中"));

    const engine = document.querySelector("audio.focus-audio-engine") as HTMLAudioElement;
    expect(engine).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "离开专注页" }));
    expect(screen.queryByText("专注声音")).not.toBeInTheDocument();
    expect(document.querySelector("audio.focus-audio-engine")).toBe(engine);
    expect(engine.paused).toBe(false);

    window.dispatchEvent(new CustomEvent("focus-picture-in-picture-audio-mute", { detail: true }));
    await waitFor(() => expect(engine.muted).toBe(true));
  });

  it("支持播放模式、播放列表和拖动进度", async () => {
    render(<FocusAudioProvider><FocusAudioPlayer /></FocusAudioProvider>);
    await screen.findByRole("combobox", { name: "选择专注音频" });
    fireEvent.click(screen.getByRole("button", { name: "音乐" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "音乐一" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "随机播放" }));
    expect(screen.getByRole("button", { name: "随机播放" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByText(/播放列表/));
    const musicTwo = screen.getByRole("checkbox", { name: "音乐二" });
    expect(musicTwo).toBeChecked();
    fireEvent.click(musicTwo);
    expect(musicTwo).not.toBeChecked();

    const engine = document.querySelector("audio.focus-audio-engine") as HTMLAudioElement;
    Object.defineProperty(engine, "duration", { configurable: true, value: 120 });
    fireEvent.loadedMetadata(engine);
    const progress = screen.getByRole("slider", { name: "播放进度" });
    fireEvent.change(progress, { target: { value: "35" } });
    expect(engine.currentTime).toBe(35);
    expect(screen.getByText("音乐仅供个人专注播放，请勿传播或用于商业用途。")).toBeInTheDocument();
  });
});
