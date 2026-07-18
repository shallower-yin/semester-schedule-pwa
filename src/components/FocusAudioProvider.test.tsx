import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listFocusAudioTracks, type FocusAudioTrack } from "../lib/focusAudio";
import { FocusAudioPlayer } from "./FocusAudioPlayer";
import { FocusAudioProvider, useFocusAudio } from "./FocusAudioProvider";

vi.mock("../lib/focusAudio", () => ({
  focusAudioPublicUrl: (path: string) => `https://audio.test/${path}`,
  listFocusAudioTracks: vi.fn()
}));

const TRACKS: FocusAudioTrack[] = [
  track("noise-1", "雨声", "white_noise", "rain.mp3", 1),
  track("music-1", "音乐一", "music", "music-1.mp3", 2),
  track("music-2", "音乐二", "music", "music-2.mp3", 3)
];

function track(id: string, title: string, kind: FocusAudioTrack["kind"], storagePath: string, sortOrder: number): FocusAudioTrack {
  return {
    id,
    title,
    kind,
    storage_path: storagePath,
    mime_type: "audio/mpeg",
    file_size: 1024,
    is_enabled: true,
    sort_order: sortOrder,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z"
  };
}

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
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
      return pausedState.get(this) ?? true;
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) {
      pausedState.set(this, true);
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      pausedState.set(this, false);
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
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
    await waitFor(() => expect(HTMLMediaElement.prototype.load).toHaveBeenCalled());
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
