import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { db } from "../db";
import { cancelAiTask, clearAllAiTasks } from "../lib/aiBackgroundTasks";
import type { DeepSeekAssistantResult } from "../lib/deepSeekAssistant";
import { syncFields } from "../lib/identity";

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
    clearAllAiTasks();
    await db.memos.clear();
    await db.memoFolders.clear();
    await db.syncQueue.clear();
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
    clearAllAiTasks();
    cleanup();
  });

  it.each(["cancel", "clear"])("请求挂起后%s任务，迟到的创建动作不会写入本地", async (mode) => {
    let resolveResponse!: (result: DeepSeekAssistantResult) => void;
    askDeepSeekAssistantMock.mockImplementationOnce(() => new Promise<DeepSeekAssistantResult>((resolve) => { resolveResponse = resolve; }));
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-cancel" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业"), { target: { value: "帮我记一条备忘录" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      if (mode === "cancel") cancelAiTask("assistant");
      else clearAllAiTasks();
      resolveResponse({ answer: "已创建", actions: [{ type: "create_memo", title: "不应写入", content: "已取消的回答" }] });
      // Drain both the late response and real IndexedDB writes if incorrectly started.
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
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
      [],
      expect.any(AbortSignal)
    );

    expect(await screen.findByText("修改后的新回答")).toBeInTheDocument();
    expect(screen.getByText("修改后的第二个问题")).toBeInTheDocument();
    expect(screen.queryByText("第二个问题")).not.toBeInTheDocument();
    expect(screen.queryByText("应被截断的旧回答")).not.toBeInTheDocument();
  });

  it.each(["mimo-v2.6-flash", "mimo-v2.6-pro"])("%s 根据服务端能力显示图片和文档入口", async (model) => {
    setMobileMode(true);
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model, supportsAttachments: true });
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
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
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
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
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

  it("按当前问题构造时间范围上下文，并支持回车发送", async () => {
    render(<DeepSeekAssistantDialog input={{ ...emptyInput, now: new Date("2026-07-17T02:00:00.000Z") }} ownerId="time-scope-user" onClose={vi.fn()} />);
    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    fireEvent.change(composer, { target: { value: "帮我梳理下周安排" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter", shiftKey: false });

    await waitFor(() => expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(1));
    expect(askDeepSeekAssistantMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      requestedTimeScope: { label: "下周", startDate: "2026-07-20", endDate: "2026-07-26" }
    }));
  });

  it("空对话提供常用问题入口", async () => {
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="new-user" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "检查本周时间冲突" }));
    expect(screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业")).toHaveValue("检查本周时间冲突");
  });

  it("附件保存在本地上下文并自动用于后续问题", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
    askDeepSeekAssistantMock
      .mockResolvedValueOnce({ answer: "已读取文件", actions: [] })
      .mockResolvedValueOnce({ answer: "后续回答", actions: [] });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
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

  it("点击待发送文档查看正文，关闭保留草稿，移除按钮不会打开预览", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="preview-document" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });
    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    fireEvent.change(composer, { target: { value: "未发送的草稿" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["课程安排"], "安排.txt", { type: "text/plain" })] }
    });
    fireEvent.click(await screen.findByRole("button", { name: "查看附件 安排.txt" }));
    const preview = await screen.findByRole("dialog", { name: "查看附件：安排.txt" });
    expect(within(preview).getByText("课程安排：周五提交报告")).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole("button", { name: "关闭" }));
    expect(composer).toHaveValue("未发送的草稿");
    expect(screen.getByRole("dialog", { name: "AI 助手" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除 安排.txt" }));
    expect(screen.queryByRole("button", { name: "查看附件 安排.txt" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(askDeepSeekAssistantMock).not.toHaveBeenCalled();
  });

  it("同名图片分别预览和发送，重开助手后消息附件仍对应原图", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
    const dataUrls = ["aW1hZ2Ux", "aW1hZ2Uy", "aW1hZ2Uz"].map((value) => `data:image/png;base64,${value}`);
    dataUrls.forEach((dataUrl) => prepareAiAssistantAttachmentMock.mockResolvedValueOnce({
      name: "image.png", mimeType: "image/png", kind: "image", dataUrl
    }));
    const { unmount } = render(<DeepSeekAssistantDialog input={emptyInput} ownerId="preview-images" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: dataUrls.map(() => new File(["image"], "image.png", { type: "image/png" })) }
    });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "查看附件 image.png" })).toHaveLength(3));
    fireEvent.click(screen.getAllByRole("button", { name: "查看附件 image.png" })[1]);
    const image = await screen.findByRole("img", { name: "image.png" });
    expect(image).toHaveAttribute("src", dataUrls[1]);
    fireEvent.load(image);
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByRole("button", { name: "重置图片缩放" })).toHaveTextContent("125%");
    fireEvent.click(within(screen.getByRole("dialog", { name: "查看图片：image.png" })).getByRole("button", { name: "关闭" }));

    fireEvent.change(screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业"), { target: { value: "读取三张图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("修改后的新回答");
    const sent = askDeepSeekAssistantMock.mock.calls[0]?.[4];
    expect(sent.map((item: { dataUrl: string }) => item.dataUrl)).toEqual(dataUrls);
    expect(new Set(sent.map((item: { id: string }) => item.id)).size).toBe(3);
    expect(localStorage.getItem("semester-schedule-ai-assistant-history:preview-images")).not.toContain("data:image");
    await waitFor(async () => expect((await db.aiAttachmentContexts.get("ai-attachment-context:preview-images"))?.attachments).toHaveLength(3));

    unmount();
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="preview-images" onClose={vi.fn()} />);
    await screen.findByLabelText("附件上下文");
    const messageAttachments = screen.getByLabelText("消息附件");
    fireEvent.click(within(messageAttachments).getAllByRole("button", { name: "查看附件 image.png" })[0]);
    expect(await screen.findByRole("img", { name: "image.png" })).toHaveAttribute("src", dataUrls[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "查看图片：image.png" })).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getAllByRole("button", { name: "移除上下文 image.png" })[0]);
    fireEvent.click(within(messageAttachments).getAllByRole("button", { name: "查看附件 image.png" })[0]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(1);
  });

  it("旧消息可预览保留的文档，移除后不再打开", async () => {
    const ownerId = "preview-legacy";
    localStorage.setItem(`semester-schedule-ai-assistant-history:${ownerId}`, JSON.stringify([
      { id: "old", role: "user", content: "请读附件\n附件：安排.txt" }
    ]));
    await db.aiAttachmentContexts.put({
      id: `ai-attachment-context:${ownerId}`, ownerId, updatedAt: new Date().toISOString(),
      attachments: [{ name: "安排.txt", mimeType: "text/plain", kind: "document", text: "已保留的文档内容" }]
    });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId={ownerId} onClose={vi.fn()} />);
    await screen.findByLabelText("附件上下文");
    const messageAttachments = screen.getByLabelText("消息附件");
    fireEvent.click(within(messageAttachments).getByRole("button", { name: "查看附件 安排.txt" }));
    const preview = await screen.findByRole("dialog", { name: "查看附件：安排.txt" });
    expect(within(preview).getByText("已保留的文档内容")).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "移除上下文 安排.txt" }));
    fireEvent.click(within(messageAttachments).getByRole("button", { name: "查看附件 安排.txt" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(askDeepSeekAssistantMock).not.toHaveBeenCalled();
  });

  it("长文档预览包含所有待整理批次的原文", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
    prepareAiAssistantAttachmentMock.mockResolvedValueOnce({
      name: "论文.pdf", mimeType: "application/pdf", kind: "document", text: "将分批整理",
      pendingTextBatches: [{ startPage: 1, endPage: 5, text: "第一批原文" }, { startPage: 6, endPage: 9, text: "第二批原文" }]
    });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="preview-batches" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "论文.pdf")] } });
    fireEvent.click(await screen.findByRole("button", { name: "查看附件 论文.pdf" }));
    const preview = await screen.findByRole("dialog", { name: "查看附件：论文.pdf" });
    expect(preview).toHaveTextContent("第一批原文");
    expect(preview).toHaveTextContent("第二批原文");
    expect(askDeepSeekAssistantMock).not.toHaveBeenCalled();
  });

  it("提供当前账号文件夹上下文，并依据实际保存结果回复而非模型的完成声明", async () => {
    await db.memoFolders.bulkPut([
      { ...syncFields(undefined, "user-1"), id: "existing-folder", name: "已有资料", sort_order: 1 },
      { ...syncFields(undefined, "another-user"), id: "private-folder", name: "其他账号资料", sort_order: 1 }
    ]);
    askDeepSeekAssistantMock.mockResolvedValueOnce({
      answer: "已处理，但 AI 暂不能直接指定文件夹归属，请手动设置。",
      actions: [
        { type: "create_memo_folder", name: "毕设" },
        { type: "create_memo", title: "开题前准备", folderName: "毕设", format: "numbered", items: [{ text: "阅读论文" }, { text: "写开题报告" }] }
      ]
    });
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="user-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业"), {
      target: { value: "创建毕设文件夹和开题前准备备忘录，列表用可勾选待办" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const receipt = await screen.findByText(/2 条可勾选待办/);
    expect(receipt).toHaveTextContent("已创建文件夹：毕设");
    expect(receipt).toHaveTextContent("文件夹：毕设");
    expect(screen.queryByText(/请手动设置/)).not.toBeInTheDocument();
    expect(askDeepSeekAssistantMock.mock.calls[0]?.[1].memoFolders).toEqual([{ id: "existing-folder", name: "已有资料" }]);
    const folder = await db.memoFolders.filter((item) => item.name === "毕设").first();
    expect((await db.memos.toArray())[0]).toMatchObject({ folder_id: folder?.id, content: "○ 阅读论文\n○ 写开题报告" });
  });

  it("表格识别错误保留具体原因，不误称整个AI助手无法使用", async () => {
    const reason = "未导入任何记录：第 1 份附件第 1 行的标题识别结果格式不正确，请重试。";
    askDeepSeekAssistantMock.mockRejectedValueOnce(new Error(reason));
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="import-error" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业"), { target: { value: "创建图片里的事项" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.queryByText(/暂时不能使用 AI 助手/)).not.toBeInTheDocument();
    expect(await db.memos.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("大图读取尚未完成时不能通过按钮或回车发送空附件请求", async () => {
    getAiAssistantConfigurationMock.mockResolvedValue({ provider: "mimo", model: "mimo-v2.6-flash", supportsAttachments: true });
    let finish!: (value: unknown) => void;
    prepareAiAssistantAttachmentMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<DeepSeekAssistantDialog input={emptyInput} ownerId="large-upload-race" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "导入图片或文档" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["large"], "large.png", { type: "image/png" })] } });
    const composer = screen.getByPlaceholderText("例如：创建端午节，或明天 9:00 添加交作业");
    fireEvent.change(composer, { target: { value: "按图片创建事项" } });
    expect(screen.getByRole("button", { name: /^发送$/ })).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    expect(askDeepSeekAssistantMock).not.toHaveBeenCalled();
    await act(async () => finish({ name: "large.png", kind: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,aW1n" }));
    await screen.findByRole("button", { name: "查看附件 large.png" });
    expect(screen.getByRole("button", { name: /^发送$/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^发送$/ }));
    await waitFor(() => expect(askDeepSeekAssistantMock).toHaveBeenCalledTimes(1));
    expect(askDeepSeekAssistantMock.mock.calls[0][4]).toEqual([expect.objectContaining({ name: "large.png" })]);
  });
});
