import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { askAiMindMapMock, getAiAssistantConfigurationMock, prepareAiAssistantAttachmentMock } = vi.hoisted(() => ({
  askAiMindMapMock: vi.fn(),
  getAiAssistantConfigurationMock: vi.fn(),
  prepareAiAssistantAttachmentMock: vi.fn()
}));

vi.mock("../lib/mindMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mindMap")>();
  return { ...actual, askAiMindMap: askAiMindMapMock };
});

vi.mock("../lib/deepSeekAssistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/deepSeekAssistant")>();
  return {
    ...actual,
    getAiAssistantConfiguration: getAiAssistantConfigurationMock
  };
});

vi.mock("../lib/assistantAttachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assistantAttachments")>();
  return { ...actual, prepareAiAssistantAttachment: prepareAiAssistantAttachmentMock };
});

import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { MindMapDialog } from "./MindMapDialog";

const emptyInput: ScheduleAssistantInput = {
  events: [],
  courses: [],
  schedules: [],
  cancellations: [],
  categories: [],
  occurrenceStates: [],
  anniversaries: [],
  memos: [],
  periods: [],
  focusSessions: []
};

describe("AI 思维导图", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    askAiMindMapMock.mockReset().mockResolvedValue({
      answer: "已生成",
      mindMap: {
        label: "项目计划",
        children: [
          { label: "需求", children: [] },
          { label: "开发", children: [{ label: "测试", children: [] }] }
        ]
      }
    });
    getAiAssistantConfigurationMock.mockReset().mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      supportsAttachments: false
    });
    prepareAiAssistantAttachmentMock.mockReset().mockResolvedValue({
      name: "扫描讲义.pdf",
      mimeType: "application/pdf",
      kind: "document",
      text: "扫描版 PDF 已读取 2 页",
      pageImages: ["data:image/jpeg;base64,cGFnZQ=="]
    });
  });

  it("提交主题后生成可查看和导出的思维导图", async () => {
    render(<MindMapDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), {
      target: { value: "整理项目计划" }
    });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));

    await waitFor(() => expect(askAiMindMapMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "整理项目计划",
      depth: "standard"
    })));
    expect(await screen.findByRole("img", { name: "项目计划 思维导图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PNG" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("dialog", { name: "思维导图预览" })).toBeInTheDocument();
    expect(localStorage.getItem("semester-schedule-mind-map:user-1")).toContain("项目计划");
  });

  it("支持深入模式和缩放到 0%", async () => {
    render(<MindMapDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("思考程度"), { target: { value: "deep" } });
    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), { target: { value: "详细整理材料" } });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    await waitFor(() => expect(askAiMindMapMock).toHaveBeenCalledWith(expect.objectContaining({ depth: "deep" })));
    const zoomOut = screen.getByRole("button", { name: "缩小脑图" });
    for (let index = 0; index < 10; index += 1) fireEvent.click(zoomOut);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("普通附件总结不发送日程上下文", async () => {
    render(<MindMapDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), { target: { value: "总结内容" } });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    await waitFor(() => expect(askAiMindMapMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "总结内容",
      context: undefined
    })));
  });

  it("生成失败后持续显示原因和重试入口", async () => {
    askAiMindMapMock.mockRejectedValueOnce(new Error("标准模式生成超时，请稍后重试。"));
    render(<MindMapDialog input={emptyInput} ownerId="user-2" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), { target: { value: "整理材料" } });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("标准模式生成超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("生成失败后保留附件，直到用户主动移除", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    askAiMindMapMock.mockRejectedValueOnce(new Error("生成失败"));
    render(<MindMapDialog input={emptyInput} ownerId="user-pdf" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "选择脑图附件来源" });
    fireEvent.change(screen.getByLabelText("从电脑选择文件"), {
      target: { files: [new File(["scan"], "扫描讲义.pdf", { type: "application/pdf" })] }
    });
    expect(await screen.findByText("扫描讲义.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("生成失败");
    expect(screen.getByText("扫描讲义.pdf")).toBeInTheDocument();
  });

  it("生成过程中可以取消当前请求", async () => {
    let signal: AbortSignal | undefined;
    askAiMindMapMock.mockImplementationOnce((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return new Promise(() => undefined);
    });
    render(<MindMapDialog input={emptyInput} ownerId="user-cancel" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), { target: { value: "整理材料" } });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    await screen.findByRole("button", { name: "取消生成" });
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "生成脑图" })).toBeInTheDocument();
  });
});
