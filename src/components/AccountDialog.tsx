import type { User } from "@supabase/supabase-js";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, BellRing, CheckCircle2, Cloud, CloudDownload, Download, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { db, queueChange } from "../db";
import { createBackup, downloadBackup } from "../lib/backup";
import { toISODate } from "../lib/date";
import { syncFields } from "../lib/identity";
import { supabase } from "../lib/supabase";
import {
  diagnoseNotifications,
  disableNotificationsForCurrentDevice,
  enableNotifications,
  getNotificationStatus,
  showTestNotification,
  type NotificationDiagnosticStep,
  type NotificationStatus
} from "../lib/notifications";
import { getSyncHealth, type SyncResult } from "../lib/sync";
import { getAdminStatus, type AdminAiAccess } from "../lib/admin";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";

interface AccountDialogProps {
  user: User;
  pendingChanges: number;
  lastSync: string | null;
  syncing: boolean;
  message: string;
  onSync: () => Promise<SyncResult | void>;
  onPullRemote: () => Promise<SyncResult | void>;
  onClose: () => void;
}

export function AccountDialog({ user, pendingChanges, lastSync, syncing, message, onSync, onPullRemote, onClose }: AccountDialogProps) {
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [diagnosticSteps, setDiagnosticSteps] = useState<NotificationDiagnosticStep[]>([]);
  const [enablingNotifications, setEnablingNotifications] = useState(false);
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const [accountAccess, setAccountAccess] = useState<AdminAiAccess | null>(null);
  const [accountTypeLoading, setAccountTypeLoading] = useState(true);
  const syncHealth = useLiveQuery(() => getSyncHealth(), [pendingChanges, message, healthRefreshKey]);

  useEffect(() => {
    void getNotificationStatus().then(setNotificationStatus);
    void diagnoseNotifications().then(setDiagnosticSteps);
  }, []);

  useEffect(() => {
    let active = true;
    setAccountTypeLoading(true);
    void getAdminStatus()
      .then((status) => {
        if (!active) return;
        setAccountAccess(status.aiAccess);
      })
      .catch(() => {
        if (!active) return;
        setAccountAccess(null);
      })
      .finally(() => {
        if (active) setAccountTypeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  async function activateNotifications() {
    setEnablingNotifications(true);
    setNotificationMessage("");
    try {
      const result = await enableNotifications((stage) => {
        setNotificationMessage({
          permission: "正在检查浏览器通知权限…",
          "service-worker": "正在启动应用后台服务…",
          "push-service": "正在连接手机系统推送服务…",
          cloud: "正在保存云端推送订阅…"
        }[stage]);
      });
      setNotificationStatus(await getNotificationStatus());
      setDiagnosticSteps(await diagnoseNotifications());
      if (result === "denied") setNotificationMessage("浏览器已阻止通知，请在网站权限中改为允许。");
      else if (result === "unsupported") setNotificationMessage("当前浏览器不支持系统通知。");
      else if (result === "local-only") setNotificationMessage("只能在应用打开时提醒，请确认已登录并联网。");
      else setNotificationMessage("当前设备已订阅系统提醒。");
    } catch (error) {
      setNotificationStatus(await getNotificationStatus());
      setDiagnosticSteps(await diagnoseNotifications());
      setNotificationMessage(error instanceof Error ? error.message : "启用提醒失败");
    } finally {
      setEnablingNotifications(false);
    }
  }

  async function testNotification() {
    setEnablingNotifications(true);
    setNotificationMessage("");
    try {
      const result = await enableNotifications();
      setNotificationStatus(await getNotificationStatus());
      setDiagnosticSteps(await diagnoseNotifications());
      if (result === "denied") {
        setNotificationMessage("浏览器已阻止通知，请在网站权限中改为允许。");
        return;
      }
      if (result === "unsupported") {
        setNotificationMessage("当前浏览器不支持系统通知。");
        return;
      }
      await showTestNotification();
      setNotificationMessage("测试通知已发送，请检查系统通知栏并点击它测试应用跳转。");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "测试通知发送失败");
    } finally {
      setEnablingNotifications(false);
    }
  }

  async function scheduleRealReminderTest() {
    setEnablingNotifications(true);
    setNotificationMessage("");
    try {
      const result = await enableNotifications();
      setNotificationStatus(await getNotificationStatus());
      setDiagnosticSteps(await diagnoseNotifications());
      if (result === "denied") {
        setNotificationMessage("浏览器已阻止通知，请先允许通知。");
        return;
      }
      if (result === "unsupported") {
        setNotificationMessage("当前浏览器不支持系统通知。");
        return;
      }
      const startsAt = new Date();
      startsAt.setMinutes(startsAt.getMinutes() + 1);
      const startTime = `${String(startsAt.getHours()).padStart(2, "0")}:${String(startsAt.getMinutes()).padStart(2, "0")}`;
      const record = {
        ...syncFields(),
        user_id: user.id,
        event_type: "event" as const,
        title: "提醒测试",
        start_date: toISODate(startsAt),
        end_date: toISODate(startsAt),
        start_time: startTime,
        end_time: startTime,
        all_day: false,
        category_id: null,
        color: "#3157d5",
        note: "由账号与同步中的提醒测试创建，用于检查本地提醒和应用关闭后的提醒。",
        recurrence_type: "none" as const,
        recurrence_until: null,
        recurrence_interval: 1,
        reminder_enabled: true,
        reminder_minutes_before: 0,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
      };
      await db.events.put(record);
      await queueChange("events", record.id);
      setNotificationMessage(`已创建 ${startTime} 的测试提醒。保持应用打开可测本地提醒，关闭应用可测后台提醒。`);
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "创建测试提醒失败");
    } finally {
      setEnablingNotifications(false);
    }
  }

  const notificationLabel = {
    unsupported: "浏览器不支持",
    "not-allowed": "尚未允许",
    blocked: "已被浏览器阻止",
    "local-only": "仅应用打开时提醒",
    "permission-only": "已允许，但未完成后台提醒",
    subscribed: "当前设备已订阅"
  }[notificationStatus ?? "not-allowed"];

  async function logout() {
    await disableNotificationsForCurrentDevice();
    await supabase?.auth.signOut();
    onClose();
  }

  async function runSync() {
    await onSync();
    setHealthRefreshKey((value) => value + 1);
  }

  async function pullRemote() {
    await onPullRemote();
    setHealthRefreshKey((value) => value + 1);
  }

  async function exportBackup() {
    downloadBackup(await createBackup(), `日程计划表备份-${new Date().toISOString().slice(0, 10)}.json`);
    showToast("备份文件已导出。", "success");
  }

  const hasSyncProblem = Boolean(message && !/完成|重新拉取|已接管/.test(message)) || Boolean(syncHealth?.failed);

  return (
    <Modal title="账号与同步" onClose={onClose}>
      <div className="account-summary">
        <div className="account-avatar">{user.email?.slice(0, 1).toUpperCase() ?? "U"}</div>
        <div>
          <strong>{user.email}</strong>
          <span><CheckCircle2 size={14} />{user.email_confirmed_at ? "邮箱已验证" : "等待邮箱验证"}</span>
          <span><ShieldCheck size={14} />账户类型：{accountTypeLoading ? "正在检查" : accountTypeLabel(accountAccess)}</span>
        </div>
      </div>
      <div className="sync-detail-card">
        <div><span>待同步</span><strong>{pendingChanges} 条</strong></div>
        <div><span>异常项</span><strong>{syncHealth?.failed ?? 0} 条</strong></div>
        <div><span>上次同步</span><strong>{lastSync ? new Date(lastSync).toLocaleString("zh-CN") : "尚未同步"}</strong></div>
        <div><span>最早待同步</span><strong>{syncHealth?.oldest_queued_at ? new Date(syncHealth.oldest_queued_at).toLocaleString("zh-CN") : "无"}</strong></div>
      </div>
      <div className={`sync-health-card ${syncHealth?.failed ? "has-error" : ""}`}>
        <div className="sync-health-title">
          {syncHealth?.failed ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <strong>{syncHealth?.pending ? "同步诊断" : "同步状态正常"}</strong>
            <span>
              {syncHealth
                ? `${syncHealth.online ? "在线" : "离线"} · ${syncHealth.cloud_configured ? "云端已配置" : "云端未配置"} · ${new Date(syncHealth.checked_at).toLocaleTimeString("zh-CN")}`
                : "正在检查…"}
            </span>
          </div>
          <button className="icon-button" onClick={() => setHealthRefreshKey((value) => value + 1)} aria-label="重新检查同步状态"><RefreshCw size={16} /></button>
        </div>
        {syncHealth?.tables.length ? (
          <div className="sync-health-list">
            {syncHealth.tables.slice(0, 6).map((table) => (
              <article key={table.table_name}>
                <div>
                  <strong>{table.label}</strong>
                  <span>{table.pending} 条待同步 · 失败 {table.failed} 条 · 尝试 {table.attempts} 次</span>
                </div>
                {table.last_error && <p>{table.last_error}</p>}
              </article>
            ))}
          </div>
        ) : (
          <p>没有等待同步的数据。若手机和电脑不一致，可以点击“重新拉取云端”。</p>
        )}
      </div>
      {hasSyncProblem && (
        <div className="sync-recovery-actions" aria-label="同步失败处理">
          <button className="button secondary compact" disabled={syncing} onClick={() => void runSync()}><RefreshCw size={16} />重试</button>
          <button className="button secondary compact" disabled={syncing} onClick={() => void pullRemote()}><CloudDownload size={16} />重新拉取云端</button>
          <button className="button secondary compact" onClick={() => void exportBackup()}><Download size={16} />导出备份</button>
        </div>
      )}
      <div className="notification-status-card">
        <BellRing size={20} />
        <div>
          <span>系统提醒</span>
          <strong>{notificationStatus ? notificationLabel : "正在检查…"}</strong>
        </div>
        <button
          className="button secondary compact"
          disabled={enablingNotifications}
          onClick={() => void activateNotifications()}
        >
          {enablingNotifications ? "检查中…" : notificationStatus === "subscribed" ? "重新检查" : "启用提醒"}
        </button>
      </div>
      {diagnosticSteps.length > 0 && (
        <div className="notification-diagnostic-list">
          {diagnosticSteps.map((step) => (
            <article key={step.id} className={step.status}>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </article>
          ))}
        </div>
      )}
      {notificationMessage && <p className="auth-message">{notificationMessage}</p>}
      {message && <p className="auth-message">{message}</p>}
      <div className="form-stack">
        <button className="button secondary" disabled={enablingNotifications} onClick={() => void testNotification()}>
          <BellRing size={17} />发送测试通知
        </button>
        <button className="button secondary" disabled={enablingNotifications} onClick={() => void scheduleRealReminderTest()}>
          <BellRing size={17} />创建 1 分钟后提醒测试
        </button>
        <button className="button primary" disabled={syncing} onClick={() => void runSync()}><Cloud size={17} />{syncing ? "同步中…" : "立即同步"}</button>
        <button className="button secondary" disabled={syncing} onClick={() => void pullRemote()}><CloudDownload size={17} />重新拉取云端</button>
        <button className="button secondary" onClick={logout}><LogOut size={17} />退出登录</button>
      </div>
    </Modal>
  );
}

function accountTypeLabel(access: AdminAiAccess | null): string {
  if (!access?.enabled) return "普通用户";
  if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) return "普通用户";
  return access.role === "admin" ? "管理员" : "会员";
}
