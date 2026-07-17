import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissAiTask, getAiTaskSnapshot, startAiTask } from "./aiBackgroundTasks";

describe("AI 后台任务", () => {
  beforeEach(() => {
    dismissAiTask("assistant");
    dismissAiTask("mind_map");
    dismissAiTask("audio_transcription");
  });

  it("离开弹窗后仍执行并保存成功状态", async () => {
    const onSuccess = vi.fn();
    expect(startAiTask({
      feature: "mind_map",
      label: "生成中",
      run: async () => "done",
      onSuccess
    })).toBe(true);
    expect(getAiTaskSnapshot("mind_map").status).toBe("running");
    await vi.waitFor(() => expect(getAiTaskSnapshot("mind_map").status).toBe("success"));
    expect(onSuccess).toHaveBeenCalledWith("done");
  });

  it("失败原因会保留供界面显示", async () => {
    startAiTask({
      feature: "audio_transcription",
      label: "转写中",
      run: async () => { throw new Error("网络连接超时"); }
    });
    await vi.waitFor(() => expect(getAiTaskSnapshot("audio_transcription").status).toBe("error"));
    expect(getAiTaskSnapshot("audio_transcription").message).toBe("网络连接超时");
  });
});
