import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { askAiMindMapMock, askAiMindMapFollowupMock, getAiAssistantConfigurationMock, prepareAiAssistantAttachmentMock } = vi.hoisted(() => ({
  askAiMindMapMock: vi.fn(),
  askAiMindMapFollowupMock: vi.fn(),
  getAiAssistantConfigurationMock: vi.fn(),
  prepareAiAssistantAttachmentMock: vi.fn()
}));

vi.mock("../lib/mindMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mindMap")>();
  return { ...actual, askAiMindMap: askAiMindMapMock, askAiMindMapFollowup: askAiMindMapFollowupMock };
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
    askAiMindMapFollowupMock.mockReset().mockResolvedValue({ answer: "传感器通过敏感元件、转换元件和调理电路完成测量。" });
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

  it("支持粘贴截图或浏览器提供的文档文件并保留选择器", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    render(<MindMapDialog input={emptyInput} ownerId="user-paste" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "选择脑图附件来源" });
    const pastedImage = new File(["image"], "剪贴板截图.png", { type: "image/png" });

    const notCanceled = fireEvent.paste(screen.getByPlaceholderText(/输入要梳理的主题/), {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => pastedImage }],
        files: []
      }
    });

    expect(notCanceled).toBe(false);
    await waitFor(() => expect(prepareAiAssistantAttachmentMock).toHaveBeenCalledWith(
      pastedImage,
      expect.objectContaining({ feature: "mind_map" })
    ));
    expect(await screen.findByText("扫描讲义.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("从电脑选择文件")).toBeInTheDocument();
    expect(screen.getByText("电脑端可按 Ctrl+V 粘贴截图或文件")).toBeInTheDocument();
  });

  it("最终生成失败后重试会复用已经读取的 PDF 文字", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    prepareAiAssistantAttachmentMock.mockResolvedValueOnce({
      name: "长讲义.pdf",
      mimeType: "application/pdf",
      kind: "document",
      text: "扫描版 PDF 已上传 8 页，将由 AI 分批读取。",
      remotePages: [{ pageNumber: 1, objectKey: "ai-documents/user/doc/page-0001.jpg", mimeType: "image/jpeg", size: 1024 }],
      pageCount: 8,
      processedPageCount: 0
    });
    askAiMindMapMock
      .mockImplementationOnce(async (request: { onAttachmentsProcessed?: (attachments: unknown[]) => void }) => {
        request.onAttachmentsProcessed?.([{
          name: "长讲义.pdf",
          mimeType: "application/pdf",
          kind: "document",
          text: "已经读取的 PDF 文字",
          pageCount: 8,
          processedPageCount: 8
        }]);
        throw new Error("PDF 文字已读取完成，但脑图生成失败");
      })
      .mockResolvedValueOnce({
        answer: "已生成",
        mindMap: { label: "讲义", children: [] }
      });

    render(<MindMapDialog input={emptyInput} ownerId="user-resume" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "选择脑图附件来源" });
    fireEvent.change(screen.getByLabelText("从电脑选择文件"), {
      target: { files: [new File(["scan"], "长讲义.pdf", { type: "application/pdf" })] }
    });
    await screen.findByText("长讲义.pdf");
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 文字已读取完成");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(askAiMindMapMock).toHaveBeenCalledTimes(2));
    const retryAttachment = askAiMindMapMock.mock.calls[1]?.[0]?.attachments?.[0];
    expect(retryAttachment).toEqual(expect.objectContaining({ text: "已经读取的 PDF 文字" }));
    expect(retryAttachment).not.toHaveProperty("remotePages");
    expect(await screen.findByRole("img", { name: "讲义 思维导图" })).toBeInTheDocument();
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

  it("生成后可以基于当前脑图和附件继续追问", async () => {
    render(<MindMapDialog input={emptyInput} ownerId="user-followup" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/输入要梳理的主题/), { target: { value: "整理振动测试" } });
    fireEvent.click(screen.getByRole("button", { name: "生成脑图" }));
    await screen.findByRole("img", { name: "项目计划 思维导图" });

    fireEvent.change(screen.getByRole("textbox", { name: "追问思维导图" }), { target: { value: "传感器如何完成测量？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送追问" }));

    await waitFor(() => expect(askAiMindMapFollowupMock).toHaveBeenCalledWith(expect.objectContaining({
      question: "传感器如何完成测量？",
      mindMap: expect.objectContaining({ label: "项目计划" })
    })));
    expect(await screen.findByText(/敏感元件/)).toBeInTheDocument();
  });
});
