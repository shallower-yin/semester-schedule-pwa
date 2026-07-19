import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRecommendedFeedbackChannelMock, listMyFeedbackMock, submitFeedbackMock } = vi.hoisted(() => ({
  getRecommendedFeedbackChannelMock: vi.fn(),
  listMyFeedbackMock: vi.fn(),
  submitFeedbackMock: vi.fn()
}));

vi.mock("../lib/feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/feedback")>();
  return {
    ...actual,
    getRecommendedFeedbackChannel: getRecommendedFeedbackChannelMock,
    listMyFeedback: listMyFeedbackMock,
    submitFeedback: submitFeedbackMock,
    openFeedbackAttachment: vi.fn()
  };
});

import { FeedbackDialog } from "./FeedbackDialog";

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

describe("意见反馈通道", () => {
  beforeEach(() => {
    setMobileMode(false);
    getRecommendedFeedbackChannelMock.mockReset().mockResolvedValue("QQ邮箱 3301469532@qq.com");
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

  it("把推荐反馈渠道的标题和联系方式放在同一行", async () => {
    render(<FeedbackDialog userId={null} onRequestLogin={vi.fn()} onClose={vi.fn()} />);

    const row = await screen.findByLabelText("推荐反馈渠道");
    expect(row).toHaveClass("feedback-recommended-channel");
    expect(within(row).getByText("推荐反馈渠道")).toBeInTheDocument();
    expect(within(row).getByText("QQ邮箱 3301469532@qq.com")).toBeInTheDocument();
  });

  it("登录用户可以提交正文和图片附件", async () => {
    setMobileMode(true);
    const { container } = render(<FeedbackDialog userId="user-1" userEmail="user@example.com" onRequestLogin={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(listMyFeedbackMock).toHaveBeenCalledWith("user-1"));

    const file = new File(["png"], "screenshot.png", { type: "image/png" });
    fireEvent.click(screen.getByRole("button", { name: "选择反馈附件来源" }));
    expect(screen.getByRole("menuitem", { name: /相册/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /拍照/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();
    const fileInput = container.querySelector('input[aria-label="从相册选择"]') as HTMLInputElement;
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
