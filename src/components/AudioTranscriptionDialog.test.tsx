import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transcribeAudioFilesMock } = vi.hoisted(() => ({ transcribeAudioFilesMock: vi.fn() }));

vi.mock("../lib/audioTranscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/audioTranscription")>();
  return { ...actual, transcribeAudioFiles: transcribeAudioFilesMock };
});

import { AudioTranscriptionDialog } from "./AudioTranscriptionDialog";

describe("AI 音频转写", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    transcribeAudioFilesMock.mockReset();
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

  it("R2 URL 模式允许选择超过旧版 7 MB 限制的音频", () => {
    render(<AudioTranscriptionDialog ownerId="user-large" onClose={vi.fn()} />);
    const large = new File(["audio"], "长录音.mp3", { type: "audio/mpeg" });
    Object.defineProperty(large, "size", { value: 8 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText("音频文件"), { target: { files: [large] } });

    expect(screen.getByText(/1\. 长录音\.mp3/)).toBeInTheDocument();
    expect(screen.getByText("8.0 MB")).toBeInTheDocument();
    expect(screen.getByText(/单个源文件不超过 100 MB|单个文件不超过 100 MB/)).toBeInTheDocument();
  });

  it("浏览器提供音频 File 时支持粘贴并保留文件选择器", () => {
    render(<AudioTranscriptionDialog ownerId="user-paste" onClose={vi.fn()} />);
    const picker = screen.getByLabelText("音频文件");
    const pastedAudio = new File(["audio"], "剪贴板录音.mp3", { type: "audio/mpeg" });

    const notCanceled = fireEvent.paste(picker, {
      clipboardData: { items: [], files: [pastedAudio] }
    });

    expect(notCanceled).toBe(false);
    expect(screen.getByText(/1\. 剪贴板录音\.mp3/)).toBeInTheDocument();
    expect(picker).toHaveAttribute("type", "file");
    expect(screen.getByText("电脑端可按 Ctrl+V 粘贴浏览器提供的音频文件")).toBeInTheDocument();
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

  it("可以清除保存在当前设备上的转写历史", () => {
    const storageKey = "semester-schedule-audio-transcription:user-3";
    localStorage.setItem(storageKey, JSON.stringify({
      transcript: "需要清除的转写。",
      summary: "摘要",
      model: "mimo-v2.5-asr",
      conversation: [{ id: "u-1", role: "user", content: "问题" }]
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<AudioTranscriptionDialog ownerId="user-3" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "清除记录" }));

    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByText("选择音频开始转写")).toBeInTheDocument();
    expect(screen.queryByText("需要清除的转写。")).not.toBeInTheDocument();
  });

  it("转写过程中可以取消上传和处理请求", async () => {
    let signal: AbortSignal | undefined;
    transcribeAudioFilesMock.mockImplementationOnce((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return new Promise(() => undefined);
    });
    render(<AudioTranscriptionDialog ownerId="user-cancel" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("音频文件"), {
      target: { files: [new File(["audio"], "录音.mp3", { type: "audio/mpeg" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "开始转写" }));
    await screen.findByRole("button", { name: "取消处理" });
    fireEvent.click(screen.getByRole("button", { name: "取消处理" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "开始转写" })).toBeInTheDocument();
  });

  it("转写过程中显示当前步骤进度", async () => {
    let onProgress: ((completed: number, total: number, step: string) => void) | undefined;
    let onUploadProgress: ((percent: number, fileName: string) => void) | undefined;
    transcribeAudioFilesMock.mockImplementationOnce((input: {
      onProgress?: (completed: number, total: number, step: string) => void;
      onUploadProgress?: (percent: number, fileName: string) => void;
    }) => {
      onProgress = input.onProgress;
      onUploadProgress = input.onUploadProgress;
      return new Promise(() => undefined);
    });
    render(<AudioTranscriptionDialog ownerId="user-progress" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("音频文件"), {
      target: { files: [new File(["audio"], "会议.mp3", { type: "audio/mpeg" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "开始转写" }));
    await screen.findByRole("status");
    expect(screen.getByText("准备上传音频…")).toBeInTheDocument();

    onUploadProgress?.(36, "会议.mp3");
    expect(await screen.findByText("正在上传：会议.mp3（36%）")).toBeInTheDocument();
    expect(screen.getByText("当前文件 36%")).toBeInTheDocument();

    onProgress?.(1, 8, "转写中");
    expect(await screen.findByText("正在转写 1/8 段")).toBeInTheDocument();
    onProgress?.(3, 8, "转写中");
    expect(await screen.findByText("正在转写 3/8 段")).toBeInTheDocument();
    onProgress?.(8, 8, "整理结果");
    expect(await screen.findByText("分段转写完成（8/8），正在整理结果…")).toBeInTheDocument();
  });
});
