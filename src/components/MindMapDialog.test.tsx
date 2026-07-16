import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      prompt: "整理项目计划"
    })));
    expect(await screen.findByRole("img", { name: "项目计划 思维导图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PNG" })).toBeInTheDocument();
    expect(localStorage.getItem("semester-schedule-mind-map:user-1")).toContain("项目计划");
  });
});
