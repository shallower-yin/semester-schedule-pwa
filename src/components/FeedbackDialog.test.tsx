import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMyFeedbackMock, submitFeedbackMock } = vi.hoisted(() => ({
  listMyFeedbackMock: vi.fn(),
  submitFeedbackMock: vi.fn()
}));

vi.mock("../lib/feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/feedback")>();
  return {
    ...actual,
    listMyFeedback: listMyFeedbackMock,
    submitFeedback: submitFeedbackMock,
    openFeedbackAttachment: vi.fn()
  };
});

import { FeedbackDialog } from "./FeedbackDialog";

describe("意见反馈通道", () => {
  beforeEach(() => {
    listMyFeedbackMock.mockReset().mockResolvedValue([]);
    submitFeedbackMock.mockReset().mockResolvedValue({
      id: "feedback-1",
      user_id: "user-1",
      user_email: "user@example.com",
      content: "手机端按钮位置不对",
      attachments: [{ name: "screenshot.png", path: "user-1/feedback-1/screenshot.png", mimeType: "image/png", size: 3 }],
      status: "new",
      admin_reply: "",
      created_at: "2026-07-16T10:00:00.000Z",
      updated_at: "2026-07-16T10:00:00.000Z"
    });
  });

  it("未登录时引导登录后再提交", () => {
    const onRequestLogin = vi.fn();
    render(<FeedbackDialog userId={null} onRequestLogin={onRequestLogin} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "登录账号" }));
    expect(onRequestLogin).toHaveBeenCalledTimes(1);
  });

  it("登录用户可以提交正文和图片附件", async () => {
    const { container } = render(<FeedbackDialog userId="user-1" userEmail="user@example.com" onRequestLogin={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(listMyFeedbackMock).toHaveBeenCalledWith("user-1"));

    const file = new File(["png"], "screenshot.png", { type: "image/png" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "手机端按钮位置不对" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

    await waitFor(() => expect(submitFeedbackMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "user@example.com",
      content: "手机端按钮位置不对",
      files: [file]
    }));
    expect(await screen.findByText("反馈已提交，管理员可以在后台查看。")).toBeInTheDocument();
    expect(screen.getByText("新反馈")).toBeInTheDocument();
  });
});
