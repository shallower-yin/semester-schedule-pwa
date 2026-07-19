import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtpMock, verifyOtpMock, signInWithPasswordMock } = vi.hoisted(() => ({
  signInWithOtpMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  signInWithPasswordMock: vi.fn()
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithOtp: signInWithOtpMock,
      verifyOtp: verifyOtpMock,
      signInWithPassword: signInWithPasswordMock,
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn()
    }
  }
}));

import { AuthDialog } from "./AuthDialog";

describe("邮箱验证码登录", () => {
  beforeEach(() => {
    signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
    verifyOtpMock.mockReset().mockResolvedValue({ error: null });
    signInWithPasswordMock.mockReset().mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("在发起登录的应用内发送并验证邮箱验证码", async () => {
    const onClose = vi.fn();
    render(<AuthDialog onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "邮箱验证码登录" }));

    await waitFor(() => expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "user@example.com",
      options: { shouldCreateUser: false }
    }));
    expect(await screen.findByRole("dialog", { name: "邮箱验证码登录" })).toBeInTheDocument();
    expect(screen.getByText("登录验证码已发送，请在当前应用中输入邮件里的验证码。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送验证码（60 秒）" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("邮箱验证码"), { target: { value: " 123 456 " } });
    fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));

    await waitFor(() => expect(verifyOtpMock).toHaveBeenCalledWith({
      email: "user@example.com",
      token: "123456",
      type: "email"
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("没有邮箱时不发送验证码", () => {
    render(<AuthDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "邮箱验证码登录" }));
    expect(screen.getByText("请先填写邮箱地址。")).toBeInTheDocument();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
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
