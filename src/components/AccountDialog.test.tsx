import type { User } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateUserMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn()
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => ({ failed: 0 })
}));

vi.mock("../db", () => ({
  db: { events: { put: vi.fn() } },
  queueChange: vi.fn()
}));

vi.mock("../lib/admin", () => ({
  getAdminStatus: vi.fn().mockResolvedValue({
    aiAccess: { enabled: true, role: "admin", expires_at: null }
  })
}));

vi.mock("../lib/backup", () => ({
  createBackup: vi.fn(),
  downloadBackup: vi.fn()
}));

vi.mock("../lib/identity", () => ({ syncFields: vi.fn() }));

vi.mock("../lib/notifications", () => ({
  diagnoseNotifications: vi.fn().mockResolvedValue([
    { id: "support", label: "浏览器能力", status: "ok", detail: "支持系统通知和应用后台服务。" },
    { id: "permission", label: "通知权限", status: "ok", detail: "浏览器已允许通知。" },
    { id: "service-worker", label: "后台服务", status: "ok", detail: "应用后台服务已激活。" },
    { id: "push-service", label: "系统推送", status: "ok", detail: "当前设备已有系统推送订阅。" },
    { id: "cloud", label: "后台提醒", status: "ok", detail: "应用关闭后的提醒已准备好。" }
  ]),
  disableNotificationsForCurrentDevice: vi.fn(),
  enableNotifications: vi.fn(),
  getNotificationStatus: vi.fn().mockResolvedValue("subscribed"),
  showTestNotification: vi.fn()
}));

vi.mock("../lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    auth: { updateUser: updateUserMock, signOut: vi.fn() },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example.com/avatar.jpg" } }))
      }))
    }
  }
}));

vi.mock("../lib/sync", () => ({ getSyncHealth: vi.fn() }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

import { AccountDialog } from "./AccountDialog";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "3301469532@qq.com",
  email_confirmed_at: "2026-07-18T01:00:00.000Z",
  user_metadata: { display_name: "南风笙歌" },
  app_metadata: {},
  aud: "authenticated",
  created_at: "2026-07-18T01:00:00.000Z"
} as User;

describe("账号与同步布局", () => {
  afterEach(cleanup);

  beforeEach(() => {
    updateUserMock.mockReset().mockResolvedValue({ error: null });
  });

  it("只保留一处同步摘要并横向展示实时通知诊断", async () => {
    const { container } = render(
      <AccountDialog
        user={user}
        pendingChanges={0}
        lastSync="2026-07-18T01:38:22.000Z"
        syncing={false}
        message="同步完成"
        onSync={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(container.querySelector(".account-summary")).toHaveTextContent("账户类型：管理员"));
    expect(screen.getAllByText("3301469532@qq.com")).toHaveLength(1);
    expect(screen.getByText("已同步")).toBeInTheDocument();
    expect(screen.getByText(/上次同步/)).not.toHaveTextContent("3301469532@qq.com");
    expect(container.querySelector(".sync-detail-card")).not.toBeInTheDocument();
    expect(container.querySelector(".sync-health-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新拉取云端" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即同步" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();

    expect(screen.getAllByText("通知权限").length).toBeGreaterThan(0);
    expect(screen.queryByText("浏览器能力")).not.toBeInTheDocument();
  });

  it("点击用户名后原地编辑并保存", async () => {
    render(
      <AccountDialog
        user={user}
        pendingChanges={0}
        lastSync={null}
        syncing={false}
        message=""
        onSync={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "南风笙歌" }));
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "新用户名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户名" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ data: { display_name: "新用户名" } }));
    expect(await screen.findByRole("button", { name: "新用户名" })).toBeInTheDocument();
  });
});
