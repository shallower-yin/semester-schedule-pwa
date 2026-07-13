import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";

const { askDeepSeekAssistantMock } = vi.hoisted(() => ({
  askDeepSeekAssistantMock: vi.fn()
}));

vi.mock("../lib/deepSeekAssistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/deepSeekAssistant")>();
  return {
    ...actual,
    askDeepSeekAssistant: askDeepSeekAssistantMock
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

describe("AI 助手消息编辑", () => {
  beforeEach(() => {
    localStorage.clear();
    askDeepSeekAssistantMock.mockReset();
    askDeepSeekAssistantMock.mockResolvedValue({ answer: "修改后的新回答", actions: [] });
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
      ]
    );

    expect(await screen.findByText("修改后的新回答")).toBeInTheDocument();
    expect(screen.getByText("修改后的第二个问题")).toBeInTheDocument();
    expect(screen.queryByText("第二个问题")).not.toBeInTheDocument();
    expect(screen.queryByText("应被截断的旧回答")).not.toBeInTheDocument();
  });
});
