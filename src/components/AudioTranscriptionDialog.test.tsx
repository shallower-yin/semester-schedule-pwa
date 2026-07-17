import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioTranscriptionDialog } from "./AudioTranscriptionDialog";

describe("AI 音频转写", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
  });

  it("支持选择多段音频并移除误选文件", () => {
    render(<AudioTranscriptionDialog ownerId="user-1" onClose={vi.fn()} />);
    const first = new File(["first"], "会议上半场.mp3", { type: "audio/mpeg" });
    const second = new File(["second"], "会议下半场.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByLabelText("音频文件"), { target: { files: [first, second] } });
    expect(screen.getByText(/1\. 会议上半场/)).toBeInTheDocument();
    expect(screen.getByText(/2\. 会议下半场/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除 会议下半场.wav" }));
    expect(screen.queryByText(/会议下半场/)).not.toBeInTheDocument();
  });

  it("已有结果时提供基于转写原文的继续问答入口", () => {
    localStorage.setItem("semester-schedule-audio-transcription:user-2", JSON.stringify({
      transcript: "会议决定周五提交报告。",
      summary: "周五提交报告",
      model: "mimo-v2.5-asr",
      files: ["会议.mp3"],
      conversation: []
    }));
    render(<AudioTranscriptionDialog ownerId="user-2" onClose={vi.fn()} />);
    expect(screen.getByText("会议决定周五提交报告。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/谁负责下一步/)).toBeInTheDocument();
  });
});
