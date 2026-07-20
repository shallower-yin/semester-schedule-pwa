import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { AssistantDialogs } from "./AssistantDialogs";

vi.mock("./ScheduleAssistantDialog", () => ({
  ScheduleAssistantDialog: ({ input, onClose }: { input: unknown; onClose: () => void }) => (
    <div data-testid="schedule-assistant" data-has-input={String(Boolean(input))}>
      <button onClick={onClose}>close</button>
    </div>
  )
}));
vi.mock("./DeepSeekAssistantDialog", () => ({
  DeepSeekAssistantDialog: ({ input, userEmail, onClose }: { input: unknown; userEmail?: string | null; onClose: () => void }) => (
    <div data-testid="deepseek" data-has-input={String(Boolean(input))} data-email={String(userEmail)}>
      <button onClick={onClose}>close</button>
    </div>
  )
}));
vi.mock("./MindMapDialog", () => ({
  MindMapDialog: ({ input, ownerId, onClose }: { input: unknown; ownerId: string; onClose: () => void }) => (
    <div data-testid="mindmap" data-has-input={String(Boolean(input))} data-owner={ownerId}>
      <button onClick={onClose}>close</button>
    </div>
  )
}));
vi.mock("./AudioTranscriptionDialog", () => ({
  AudioTranscriptionDialog: ({ ownerId, onClose }: { ownerId: string; onClose: () => void }) => (
    <div data-testid="audio" data-owner={ownerId}>
      <button onClick={onClose}>close</button>
    </div>
  )
}));
vi.mock("./AiToolboxDialog", () => ({
  AiToolboxDialog: ({ onOpenAssistant, onOpenMindMap, onOpenAudioTranscription, onClose }: {
    onOpenAssistant: () => void; onOpenMindMap: () => void; onOpenAudioTranscription: () => void; onClose: () => void;
  }) => (
    <div data-testid="toolbox">
      <button onClick={onOpenAssistant}>open-assistant</button>
      <button onClick={onOpenMindMap}>open-mindmap</button>
      <button onClick={onOpenAudioTranscription}>open-audio</button>
      <button onClick={onClose}>close</button>
    </div>
  )
}));

const input = { semester: null } as unknown as ScheduleAssistantInput;

function setup(overrides: Record<string, unknown> = {}) {
  const setters = {
    setShowScheduleAssistant: vi.fn(),
    setShowDeepSeekAssistant: vi.fn(),
    setShowMindMap: vi.fn(),
    setShowAudioTranscription: vi.fn(),
    setShowAiToolbox: vi.fn()
  };
  render(
    <AssistantDialogs
      input={input}
      ownerId="local"
      userEmail="a@b.c"
      showScheduleAssistant={false}
      showDeepSeekAssistant={false}
      showMindMap={false}
      showAudioTranscription={false}
      showAiToolbox={false}
      {...setters}
      {...overrides}
    />
  );
  return setters;
}

afterEach(cleanup);

describe("AssistantDialogs 编排", () => {
  it("默认不渲染任何弹窗", () => {
    setup();
    expect(screen.queryByTestId("schedule-assistant")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deepseek")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mindmap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audio")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toolbox")).not.toBeInTheDocument();
  });

  it("日程助手：按标志渲染并转发共享 input，关闭回调正确", async () => {
    const setters = setup({ showScheduleAssistant: true });
    const node = await screen.findByTestId("schedule-assistant");
    expect(node).toHaveAttribute("data-has-input", "true");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(setters.setShowScheduleAssistant).toHaveBeenCalledWith(false);
  });

  it("AI 助手：转发 input 与 userEmail", async () => {
    setup({ showDeepSeekAssistant: true });
    const node = await screen.findByTestId("deepseek");
    expect(node).toHaveAttribute("data-has-input", "true");
    expect(node).toHaveAttribute("data-email", "a@b.c");
  });

  it("思维导图：转发 input 与 ownerId", async () => {
    setup({ showMindMap: true });
    const node = await screen.findByTestId("mindmap");
    expect(node).toHaveAttribute("data-has-input", "true");
    expect(node).toHaveAttribute("data-owner", "local");
  });

  it("音频转写：转发 ownerId", async () => {
    setup({ showAudioTranscription: true });
    const node = await screen.findByTestId("audio");
    expect(node).toHaveAttribute("data-owner", "local");
  });

  it("AI 工具箱：入口按钮切换到对应弹窗，关闭回调正确", () => {
    const setters = setup({ showAiToolbox: true });
    expect(screen.getByTestId("toolbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "open-assistant" }));
    expect(setters.setShowDeepSeekAssistant).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "open-mindmap" }));
    expect(setters.setShowMindMap).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "open-audio" }));
    expect(setters.setShowAudioTranscription).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(setters.setShowAiToolbox).toHaveBeenCalledWith(false);
  });
});
