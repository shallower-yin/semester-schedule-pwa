import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { startAiTask, dismissAiTask } from "../lib/aiBackgroundTasks";
import { AiTaskCenter } from "./AiTaskCenter";

describe("AI 后台任务浮窗", () => {
  beforeEach(() => {
    localStorage.clear();
    dismissAiTask("assistant");
    dismissAiTask("mind_map");
    dismissAiTask("audio_transcription");
  });

  it("可折叠并记住折叠状态", () => {
    startAiTask({ feature: "audio_transcription", label: "正在转写 1 个音频", run: () => new Promise(() => undefined) });
    const { unmount } = render(<AiTaskCenter />);
    fireEvent.click(screen.getByRole("button", { name: "折叠AI后台任务" }));
    expect(screen.getByRole("button", { name: "展开AI后台任务" })).toBeInTheDocument();
    unmount();
    render(<AiTaskCenter />);
    expect(screen.getByRole("button", { name: "展开AI后台任务" })).toBeInTheDocument();
  });
});
