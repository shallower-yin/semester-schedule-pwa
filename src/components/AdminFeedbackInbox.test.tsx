import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getRecommendedFeedbackChannelMock,
  listAdminFeedbackMock,
  updateAdminFeedbackMock,
  updateRecommendedFeedbackChannelMock
} = vi.hoisted(() => ({
  getRecommendedFeedbackChannelMock: vi.fn(),
  listAdminFeedbackMock: vi.fn(),
  updateAdminFeedbackMock: vi.fn(),
  updateRecommendedFeedbackChannelMock: vi.fn()
}));

vi.mock("../lib/feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/feedback")>();
  return {
    ...actual,
    getRecommendedFeedbackChannel: getRecommendedFeedbackChannelMock,
    listAdminFeedback: listAdminFeedbackMock,
    updateAdminFeedback: updateAdminFeedbackMock,
    updateRecommendedFeedbackChannel: updateRecommendedFeedbackChannelMock
  };
});

import { AdminFeedbackInbox } from "./AdminFeedbackInbox";

describe("管理端反馈渠道", () => {
  beforeEach(() => {
    getRecommendedFeedbackChannelMock.mockReset().mockResolvedValue("QQ邮箱 old@example.com");
    listAdminFeedbackMock.mockReset().mockResolvedValue([]);
    updateAdminFeedbackMock.mockReset().mockResolvedValue(undefined);
    updateRecommendedFeedbackChannelMock.mockReset().mockImplementation(async (value: string) => value.trim());
  });

  it("读取并保存推荐反馈渠道", async () => {
    render(<AdminFeedbackInbox />);

    const input = await screen.findByLabelText("推荐反馈渠道");
    expect(input).toHaveValue("QQ邮箱 old@example.com");
    fireEvent.change(input, { target: { value: "QQ邮箱 3301469532@qq.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateRecommendedFeedbackChannelMock).toHaveBeenCalledWith("QQ邮箱 3301469532@qq.com"));
    expect(await screen.findByText("推荐反馈渠道已保存。")).toBeInTheDocument();
  });
});
