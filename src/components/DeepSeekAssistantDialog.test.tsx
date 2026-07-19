import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { db } from "../db";

const { askDeepSeekAssistantMock, getAiAssistantConfigurationMock, prepareAiAssistantAttachmentMock } = vi.hoisted(() => ({
  askDeepSeekAssistantMock: vi.fn(),
  getAiAssistantConfigurationMock: vi.fn(),
  prepareAiAssistantAttachmentMock: vi.fn()
}));

vi.mock("../lib/assistantAttachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assistantAttachments")>();
  return {
    ...actual,
    prepareAiAssistantAttachment: prepareAiAssistantAttachmentMock
  };
});

vi.mock("../lib/deepSeekAssistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/deepSeekAssistant")>();
  return {
    ...actual,
    askDeepSeekAssistant: askDeepSeekAssistantMock,
    getAiAssistantConfiguration: getAiAssistantConfigurationMock
  };
});

import { DeepSeekAssistantDialog } from "./DeepSeekAssistantDialog";

const emptyInput: ScheduleAssistantInput = {
  semester: null,
  courses: [],
  schedules: [],
  cancellations: [],
  events: [],
  categories: [],
  occurrenceStates: [],
  anniversaries: [],
  memos: [],
  periods: [],
  focusSessions: []
};

function setMobileMode(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 900px), (pointer: coarse)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: matches ? 1 : 0 });
}

describe("AI 助手消息编辑", () => {
  beforeEach(async () => {
    setMobileMode(false);
    localStorage.clear();
    await db.aiAttachmentContexts.clear();
    askDeepSeekAssistantMock.mockReset();
    getAiAssistantConfigurationMock.mockReset();
    prepareAiAssistantAttachmentMock.mockReset().mockResolvedValue({
      name: "安排.txt",
      mimeType: "text/plain",
      kind: "document",
      text: "课程安排：周五提交报告"
    });
    askDeepSeekAssistantMock.mockResolvedValue({ answer: "修改后的新回答", actions: [] });
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false });
    localStorage.setItem("semester-schedule-ai-assistant-history:user-1", JSON.stringify([
      { id: "u-1", role: "user", content: "第一个问题" },
      { id: "a-1", role: "assistant", content: "第一个回答" },
      { id: "u-2", role: "user", content: "第二个问题" },
      { id: "a-2", role: "assistant", content: "应被截断的旧回答" }
    ]));
  });

  afterEach(() => {
    cleanup();
  });

  it("在原消息位置编辑，并从该轮重新发送", async () => {
    render(
      <DeepSeekAssistantDialog
        input={emptyInput}
        ownerId="user-1"
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "编辑这条消息" })[1]);

    const editor = screen.getByRole("textbox", { name: "编辑消息内容" });
    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    expect(editor).toHaveValue("第二个问题");
    expect(composer).toHaveValue("");
    expect(composer).toBeDisabled();

    fireEvent.change(editor, { target: { value: "修改后的第二个问题" } });
    fireEvent.click(screen.getByRole("button", { name: "重新发送" }));

    await waitFor(() => expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(1));
    expect(askDeepSeekAssistantMock).toHaveBeenCalledWith(
      "修改后的第二个问题",
      expect.any(Object),
      "",
      [
        { role: "user", content: "第一个问题" },
        { role: "assistant", content: "第一个回答" }
      ],
      []
    );

    expect(await screen.findByText("修改后的新回答")).toBeInTheDocument();
    expect(screen.getByText("修改后的第二个问题")).toBeInTheDocument();
    expect(screen.queryByText("第二个问题")).not.toBeInTheDocument();
    expect(screen.queryByText("应被截断的旧回答")).not.toBeInTheDocument();
  });

  it("只有 MiMo 2.5 模式显示图片和文档入口", async () => {
    setMobileMode(true);
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);

    const attachmentButton = await screen.findByRole("button", { name: "导入图片或文档" });
    fireEvent.click(attachmentButton);
    expect(screen.getByRole("menuitem", { name: /相册/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /拍照/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();
  });

  it("手机底部始终保留删除对话按钮", async () => {
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "删除对话" })).toBeInTheDocument();
  });

  it("从剪贴板读取浏览器提供的图片或文档文件", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-paste" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });
    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    const pastedDocument = new File(["课程安排"], "复制的讲义.txt", { type: "text/plain" });

    const notCanceled = fireEvent.paste(composer, {
      clipboardData: { items: [], files: [pastedDocument] }
    });

    expect(notCanceled).toBe(false);
    await waitFor(() => expect(prepareAiAssistantAttachmentMock).toHaveBeenCalledWith(
      pastedDocument,
      expect.objectContaining({ feature: "assistant" })
    ));
    expect(await screen.findByText("安排.txt")).toBeInTheDocument();
    expect(screen.getByText("电脑端可按 Ctrl+V 粘贴截图或文件")).toBeInTheDocument();
  });

  it("纯文字粘贴保持浏览器默认输入行为", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-text-paste" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });

    const notCanceled = fireEvent.paste(
      screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业"),
      { clipboardData: { items: [{ kind: "string", getAsFile: () => null }], files: [] } }
    );

    expect(notCanceled).toBe(true);
    expect(prepareAiAssistantAttachmentMock).not.toHaveBeenCalled();
  });

  it("发送完成后把消息区滚动到最新一轮", async () => {
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    const messageLog = screen.getByRole("log", { name: "AI 助手对话" });
    Object.defineProperty(messageLog, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    Object.defineProperty(messageLog, "scrollTo", { configurable: true, value: scrollTo });

    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    fireEvent.change(composer, { target: { value: "看看最新安排" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("修改后的新回答");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1200 })));
  });

  it("附件保存在本地上下文并自动用于后续问题", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.5", supportsAttachments: true });
    askDeepSeekAssistantMock
      .mockResolvedValueOnce({ answer: "已读取文件", actions: [] })
      .mockResolvedValueOnce({ answer: "后续回答", actions: [] });
    const { container } = render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["课程安排：周五提交报告"], "安排.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("安排.txt")).toBeInTheDocument();

    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    fireEvent.change(composer, { target: { value: "先读一下" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("已读取文件")).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "报告什么时候交" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(2));
    expect(askDeepSeekAssistantMock.mock.calls[1]?.[4]).toEqual([
      expect.objectContaining({ name: "安排.txt", kind: "document", text: "课程安排：周五提交报告" })
    ]);
    expect(await db.aiAttachmentContexts.get("ai-attachment-context:user-1")).toBeTruthy();
  });
});
