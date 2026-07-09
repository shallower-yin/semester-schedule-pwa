import { describe, expect, it } from "vitest";
import { buildSyncStatus } from "./syncStatus";

describe("同步状态摘要", () => {
  it("账号未检查完成时显示检查中", () => {
    expect(buildSyncStatus({
      authReady: false,
      cloudConfigured: true,
      signedIn: false,
      syncing: false,
      pendingChanges: 0
    })).toMatchObject({
      state: "checking",
      title: "正在检查账号",
      primaryAction: "none"
    });
  });

  it("未登录但有本地变更时提示登录同步", () => {
    expect(buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: false,
      syncing: false,
      pendingChanges: 2
    })).toMatchObject({
      state: "signed-out",
      title: "未登录同步账号",
      primaryAction: "login"
    });
  });

  it("同步中优先显示正在同步", () => {
    expect(buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: true,
      userEmail: "user@example.com",
      syncing: true,
      pendingChanges: 3,
      failedChanges: 1,
      message: "上传失败"
    })).toMatchObject({
      state: "syncing",
      title: "正在同步",
      needsRecoveryActions: false
    });
  });

  it("失败消息或异常队列显示同步失败和恢复入口", () => {
    const byMessage = buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: true,
      userEmail: "user@example.com",
      syncing: false,
      pendingChanges: 1,
      message: "上传失败"
    });
    expect(byMessage).toMatchObject({
      state: "error",
      title: "同步失败",
      primaryAction: "retry",
      needsRecoveryActions: true
    });

    expect(buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: true,
      syncing: false,
      pendingChanges: 0,
      failedChanges: 2
    })).toMatchObject({
      state: "error",
      title: "同步失败",
      needsRecoveryActions: true
    });
  });

  it("无异常时区分待同步和已同步", () => {
    expect(buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: true,
      syncing: false,
      pendingChanges: 4,
      message: "同步完成"
    })).toMatchObject({
      state: "pending",
      title: "待同步",
      primaryAction: "sync"
    });

    expect(buildSyncStatus({
      authReady: true,
      cloudConfigured: true,
      signedIn: true,
      syncing: false,
      pendingChanges: 0,
      lastSyncText: "07/09 21:50"
    })).toMatchObject({
      state: "synced",
      title: "已同步",
      tone: "success"
    });
  });
});
