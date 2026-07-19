import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithPasswordMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn()
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn()
    }
  }
}));

import { AuthDialog } from "./AuthDialog";

describe("账号密码登录", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset().mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("不再显示邮箱验证码或免密登录入口", () => {
    render(<AuthDialog onClose={vi.fn()} />);
    expect(screen.queryByText(/验证码登录|免密邮箱登录/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注册账号" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忘记密码" })).toBeInTheDocument();
  });

  it("继续支持在当前应用中使用密码登录", async () => {
    const onClose = vi.fn();
    render(<AuthDialog onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123"
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
