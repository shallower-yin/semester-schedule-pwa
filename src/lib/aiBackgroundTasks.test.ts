import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_TASK_STORAGE_KEY, cancelAiTask, clearAllAiTasks, dismissAiTask, getAiTaskSnapshot, startAiTask, updateAiTaskProgress } from "./aiBackgroundTasks";

describe("AI 后台任务", () => {
  beforeEach(() => {
    clearAllAiTasks();
    dismissAiTask("assistant");
    dismissAiTask("translation");
    dismissAiTask("mind_map");
    dismissAiTask("audio_transcription");
  });

  afterEach(() => {
    clearAllAiTasks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("任务在执行微任务前已取消时不再启动实际操作", async () => {
    const run = vi.fn().mockResolvedValue("done");
    startAiTask({ feature: "assistant", label: "准备请求", run });
    expect(cancelAiTask("assistant")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).not.toHaveBeenCalled();
    expect(getAiTaskSnapshot("assistant").status).toBe("idle");
  });

  it("错误回调写入本地存储失败仍保留原错误并结束任务", async () => {
    const onError = vi.fn(async () => { throw new DOMException("存储空间已满", "QuotaExceededError"); });
    startAiTask({
      feature: "assistant",
      label: "正在回答",
      run: async () => { throw new Error("AI 服务超时"); },
      onError
    });
    await vi.waitFor(() => expect(getAiTaskSnapshot("assistant").status).toBe("error"));
    expect(getAiTaskSnapshot("assistant").message).toBe("AI 服务超时");
    expect(onError).toHaveBeenCalledOnce();
    expect(startAiTask({ feature: "assistant", label: "重试", run: () => new Promise(() => undefined) })).toBe(true);
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

  it.each(["success", "error"] as const)("%s 系统通知被拒绝不产生未处理异常或改变任务结果", async (outcome) => {
    const showNotification = vi.fn().mockRejectedValue(new DOMException("系统通知不可用", "InvalidStateError"));
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ showNotification }) } });
    startAiTask({
      feature: "assistant",
      label: "处理任务",
      run: async () => {
        if (outcome === "error") throw new Error("原始失败原因");
        return "done";
      }
    });
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
    expect(getAiTaskSnapshot("assistant").status).toBe(outcome);
    if (outcome === "error") expect(getAiTaskSnapshot("assistant").message).toBe("原始失败原因");
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

  it("成功提示三秒后自动消失", async () => {
    vi.useFakeTimers();
    try {
      startAiTask({
        feature: "assistant",
        label: "回答中",
        run: async () => "done"
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(getAiTaskSnapshot("assistant").status).toBe("success");
      await vi.advanceTimersByTimeAsync(2999);
      expect(getAiTaskSnapshot("assistant").status).toBe("success");
      await vi.advanceTimersByTimeAsync(1);
      expect(getAiTaskSnapshot("assistant").status).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("运行中可以更新进度文案", async () => {
    startAiTask({
      feature: "audio_transcription",
      label: "转写中",
      run: () => new Promise(() => undefined)
    });
    expect(getAiTaskSnapshot("audio_transcription").status).toBe("running");
    updateAiTaskProgress("audio_transcription", "正在上传 1/2：会议.mp3");
    expect(getAiTaskSnapshot("audio_transcription").message).toBe("正在上传 1/2：会议.mp3");
    updateAiTaskProgress("audio_transcription", "上传完成，正在转写…");
    expect(getAiTaskSnapshot("audio_transcription").message).toBe("上传完成，正在转写…");
    cancelAiTask("audio_transcription");
  });

  it("取消任务会中止请求且不再写入失败状态", async () => {
    let taskSignal: AbortSignal | undefined;
    const onSuccess = vi.fn();
    startAiTask({
      feature: "mind_map",
      label: "生成中",
      run: (signal) => {
        taskSignal = signal;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
      onSuccess
    });
    await vi.waitFor(() => expect(taskSignal).toBeDefined());
    expect(cancelAiTask("mind_map")).toBe(true);
    expect(taskSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(getAiTaskSnapshot("mind_map").status).toBe("idle");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("把运行状态写入持久存储并在取消后清理", () => {
    startAiTask({
      feature: "translation",
      label: "正在翻译",
      run: () => new Promise(() => undefined)
    });

    expect(localStorage.getItem(AI_TASK_STORAGE_KEY)).toContain('"status":"running"');
    cancelAiTask("translation");
    expect(localStorage.getItem(AI_TASK_STORAGE_KEY)).toBeNull();
  });

  it.each(["success", "error"] as const)("%s 回调等待期间退出账号不会复活任务或覆盖新任务", async (outcome) => {
    let finishCallback!: () => void;
    const callback = vi.fn(() => new Promise<void>((resolve) => { finishCallback = resolve; }));
    startAiTask({
      feature: "mind_map",
      label: "旧任务",
      run: async () => {
        if (outcome === "error") throw new Error("旧错误");
        return "done";
      },
      ...(outcome === "success" ? { onSuccess: callback } : { onError: callback })
    });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    clearAllAiTasks();
    let newSignal: AbortSignal | undefined;
    startAiTask({
      feature: "mind_map",
      label: "新任务",
      run: (signal) => {
        newSignal = signal;
        return new Promise(() => undefined);
      }
    });
    finishCallback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAiTaskSnapshot("mind_map")).toMatchObject({ status: "running", label: "新任务" });
    expect(cancelAiTask("mind_map")).toBe(true);
    expect(newSignal?.aborted).toBe(true);
  });
});
