export type SyncUiState = "checking" | "local" | "signed-out" | "syncing" | "error" | "pending" | "synced";
export type SyncUiTone = "neutral" | "warning" | "success";

export interface SyncUiSummary {
  state: SyncUiState;
  tone: SyncUiTone;
  title: string;
  detail: string;
  primaryAction: "none" | "login" | "sync" | "retry";
  needsRecoveryActions: boolean;
}

interface BuildSyncStatusInput {
  authReady: boolean;
  cloudConfigured: boolean;
  signedIn: boolean;
  userEmail?: string | null;
  syncing: boolean;
  pendingChanges: number;
  failedChanges?: number;
  message?: string | null;
  lastSyncText?: string;
}

export function buildSyncStatus(input: BuildSyncStatusInput): SyncUiSummary {
  const pendingText = input.pendingChanges > 0 ? `${input.pendingChanges} 条本地变更待同步` : "暂无待同步数据";
  const failedChanges = Math.max(0, Number(input.failedChanges ?? 0));
  const hasError = failedChanges > 0 || Boolean(input.message && !isSuccessSyncMessage(input.message));
  const emailPrefix = input.userEmail ? `${input.userEmail} · ` : "";

  if (!input.authReady) {
    return {
      state: "checking",
      tone: "neutral",
      title: "正在检查账号",
      detail: "本地数据照常可用，正在确认当前登录状态。",
      primaryAction: "none",
      needsRecoveryActions: false
    };
  }

  if (!input.cloudConfigured) {
    return {
      state: "local",
      tone: "warning",
      title: "仅本地使用",
      detail: `数据会保存在当前设备。${pendingText}。`,
      primaryAction: "none",
      needsRecoveryActions: false
    };
  }

  if (!input.signedIn) {
    return {
      state: "signed-out",
      tone: "warning",
      title: "未登录同步账号",
      detail: `本地保存正常，登录后可在手机和电脑间同步。${pendingText}。`,
      primaryAction: "login",
      needsRecoveryActions: false
    };
  }

  if (input.syncing) {
    return {
      state: "syncing",
      tone: "neutral",
      title: "正在同步",
      detail: `${emailPrefix}正在上传本机变更并拉取云端数据。`,
      primaryAction: "none",
      needsRecoveryActions: false
    };
  }

  if (hasError) {
    const problem = input.message && !isSuccessSyncMessage(input.message)
      ? input.message
      : `${failedChanges} 条同步异常`;
    return {
      state: "error",
      tone: "warning",
      title: "同步失败",
      detail: `${emailPrefix}${problem}。可以重试、重新拉取云端，或先导出备份。`,
      primaryAction: "retry",
      needsRecoveryActions: true
    };
  }

  if (input.pendingChanges > 0) {
    return {
      state: "pending",
      tone: "warning",
      title: "待同步",
      detail: `${emailPrefix}${pendingText}。`,
      primaryAction: "sync",
      needsRecoveryActions: false
    };
  }

  return {
    state: "synced",
    tone: "success",
    title: "已同步",
    detail: `${emailPrefix}上次同步 ${input.lastSyncText ?? "暂无同步记录"}。`,
    primaryAction: "sync",
    needsRecoveryActions: false
  };
}

function isSuccessSyncMessage(message: string): boolean {
  return /完成|重新拉取|已接管|已同步/.test(message);
}
