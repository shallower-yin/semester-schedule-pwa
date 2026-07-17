import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { askAiMindMapMock, getAiAssistantConfigurationMock } = vi.hoisted(() => ({
  askAiMindMapMock: vi.fn(),
  getAiAssistantConfigurationMock: vi.fn()
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
});
