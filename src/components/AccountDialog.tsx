import type { User } from "@supabase/supabase-js";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, BellRing, Camera, CheckCircle2, Cloud, Download, LogOut, Pencil, RefreshCw, Save, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { db, queueChange } from "../db";
import { createBackup, downloadBackup } from "../lib/backup";
import { toISODate } from "../lib/date";
import { syncFields } from "../lib/identity";
import { supabase, supabaseConfigured } from "../lib/supabase";
import {
  checkDueLocalReminders,
  diagnoseNotifications,
  disableNotificationsForCurrentDevice,
  enableNotifications,
  getNotificationStatus,
  showTestNotification,
  type NotificationDiagnosticStep,
  type NotificationStatus
} from "../lib/notifications";
import { isNativeApp } from "../lib/nativeApp";
import { getSyncHealth, type SyncResult } from "../lib/sync";
import { getAdminStatus, type AdminAiAccess } from "../lib/admin";
import { buildSyncStatus } from "../lib/syncStatus";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";

interface AccountDialogProps {
  user: User;
  pendingChanges: number;
  lastSync: string | null;
  syncing: boolean;
  message: string;
  onSync: () => Promise<SyncResult | void>;
  onClose: () => void;
}

export function AccountDialog({ user, pendingChanges, lastSync, syncing, message, onSync, onClose }: AccountDialogProps) {
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [diagnosticSteps, setDiagnosticSteps] = useState<NotificationDiagnosticStep[]>([]);
  const [enablingNotifications, setEnablingNotifications] = useState(false);
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const [accountAccess, setAccountAccess] = useState<AdminAiAccess | null>(null);
  const [accountTypeLoading, setAccountTypeLoading] = useState(true);
  const [username, setUsername] = useState(() => String(user.user_metadata?.display_name ?? ""));
  const [usernameDraft, setUsernameDraft] = useState(() => String(user.user_metadata?.display_name ?? ""));
  const [editingUsername, setEditingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(() => accountAvatarUrl(user));
  const [savingAvatar, setSavingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
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
          permission: isNativeApp() ? "正在检查系统通知权限…" : "正在检查浏览器通知权限…",
          "service-worker": "正在启动应用后台服务…",
          "push-service": "正在连接手机系统推送服务…",
          cloud: "正在保存云端推送订阅…"
        }[stage]);
      });
      setNotificationStatus(await getNotificationStatus());
      setDiagnosticSteps(await diagnoseNotifications());
      if (result === "denied") setNotificationMessage(isNativeApp() ? "未获得系统通知权限，请在系统设置中允许通知后重试。" : "浏览器已阻止通知，请在网站权限中改为允许。");
      else if (result === "unsupported") setNotificationMessage("当前浏览器不支持系统通知。");
      else if (result === "local-only") setNotificationMessage("只能在应用打开时提醒，请确认已登录并联网。");
      else setNotificationMessage(isNativeApp() ? "系统提醒已开启，应用关闭后也会按时提醒。" : "当前设备已订阅系统提醒。");
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
        setNotificationMessage(isNativeApp() ? "未获得系统通知权限，请在系统设置中允许通知后重试。" : "浏览器已阻止通知，请在网站权限中改为允许。");
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
        setNotificationMessage(isNativeApp() ? "未获得系统通知权限，请在系统设置中允许通知后重试。" : "浏览器已阻止通知，请先允许通知。");
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
        location: "",
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
      if (isNativeApp()) await checkDueLocalReminders(user.id);
      setNotificationMessage(
        isNativeApp()
          ? `已安排 ${startTime} 的提醒。可以关闭应用，届时系统会按时通知你。`
          : `已创建 ${startTime} 的测试提醒。保持应用打开可测本地提醒，关闭应用可测后台提醒。`
      );
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

  async function saveUsername() {
    const value = usernameDraft.trim();
    if (!value || value.length > 24) {
      showToast("用户名需要填写 1 至 24 个字符。", "error");
      return;
    }
    setSavingUsername(true);
    try {
      const { error } = await supabase!.auth.updateUser({ data: { display_name: value } });
      if (error) throw error;
      setUsername(value);
      setUsernameDraft(value);
      setEditingUsername(false);
      showToast("用户名已保存。", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存用户名失败。", "error");
    } finally {
      setSavingUsername(false);
    }
  }

  async function changeAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      showToast("请选择不超过 8 MB 的图片。", "error");
      return;
    }
    setSavingAvatar(true);
    try {
      const avatarBlob = await resizeAccountAvatar(file);
      const avatarPath = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase!.storage
        .from("account-avatars")
        .upload(avatarPath, avatarBlob, { cacheControl: "3600", contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      const publicUrl = supabase!.storage.from("account-avatars").getPublicUrl(avatarPath).data.publicUrl;
      const { error } = await supabase!.auth.updateUser({
        data: { account_avatar_path: avatarPath, account_avatar_url: publicUrl }
      });
      if (error) throw error;
      setAvatarUrl(`${publicUrl}?v=${Date.now()}`);
      showToast("头像已更新。", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新头像失败。", "error");
    } finally {
      setSavingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function runSync() {
    await onSync();
    setHealthRefreshKey((value) => value + 1);
  }

  async function exportBackup() {
    downloadBackup(await createBackup(), `日程计划表备份-${new Date().toISOString().slice(0, 10)}.json`);
    showToast("备份文件已导出。", "success");
  }

  const hasSyncProblem = Boolean(message && !/完成|重新拉取|已接管/.test(message)) || Boolean(syncHealth?.failed);
  const syncStatus = buildSyncStatus({
    authReady: true,
    cloudConfigured: supabaseConfigured,
    signedIn: true,
    userEmail: null,
    syncing,
    pendingChanges,
    failedChanges: syncHealth?.failed ?? 0,
    message,
    lastSyncText: formatAccountSyncDate(lastSync)
  });

  return (
    <Modal title="账号与同步" onClose={onClose}>
      <div className="account-summary">
        <input
          ref={avatarInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => void changeAvatar(event.target.files?.[0])}
        />
        <button
          type="button"
          className="account-avatar"
          disabled={savingAvatar}
          onClick={() => avatarInputRef.current?.click()}
          aria-label="更换头像"
          title="更换头像"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{(username || user.email || "U").slice(0, 1).toUpperCase()}</span>}
          <i><Camera size={12} /></i>
        </button>
        <div>
          {editingUsername ? (
            <div className="account-inline-username-editor">
              <input
                autoFocus
                maxLength={24}
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveUsername();
                  if (event.key === "Escape") {
                    setUsernameDraft(username);
                    setEditingUsername(false);
                  }
                }}
                aria-label="用户名"
              />
              <button type="button" className="icon-button" disabled={savingUsername} onClick={() => void saveUsername()} aria-label="保存用户名"><Save size={15} /></button>
              <button type="button" className="icon-button" disabled={savingUsername} onClick={() => { setUsernameDraft(username); setEditingUsername(false); }} aria-label="取消编辑用户名"><X size={15} /></button>
            </div>
          ) : (
            <button type="button" className="account-username-button" onClick={() => { setUsernameDraft(username); setEditingUsername(true); }}>
              <strong>{username || "设置用户名"}</strong><Pencil size={14} />
            </button>
          )}
          {user.email && <span><UserRound size={14} />{user.email}</span>}
          <span><CheckCircle2 size={14} />{user.email_confirmed_at ? "邮箱已验证" : "等待邮箱验证"}</span>
          <span><ShieldCheck size={14} />账户类型：{accountTypeLoading ? "正在检查" : accountTypeLabel(accountAccess)}</span>
        </div>
      </div>
      <div className={`account-sync-state-card ${syncStatus.tone}`}>
        {syncStatus.state === "error" ? <AlertTriangle size={20} /> : syncStatus.state === "synced" ? <CheckCircle2 size={20} /> : <Cloud size={20} />}
        <div className="account-sync-state-copy">
          <strong>{syncStatus.title}</strong>
          <span>{syncStatus.detail}</span>
        </div>
      </div>
      {(hasSyncProblem || syncStatus.needsRecoveryActions) && (
        <div className="sync-recovery-actions" aria-label="同步失败处理">
          <button className="button secondary compact" disabled={syncing} onClick={() => void runSync()}><RefreshCw size={16} />重试同步</button>
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
      <div className="account-test-actions">
        <button className="button secondary" disabled={enablingNotifications} onClick={() => void testNotification()}>
          <BellRing size={17} />发送测试通知
        </button>
        <button className="button secondary" disabled={enablingNotifications} onClick={() => void scheduleRealReminderTest()}>
          <BellRing size={17} />1 分钟后提醒测试
        </button>
      </div>
      <div className="account-sync-actions">
        <button className="button primary" disabled={syncing} onClick={() => void runSync()}><Cloud size={17} />{syncing ? "同步中…" : syncStatus.primaryAction === "retry" ? "重试同步" : "立即同步"}</button>
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

function formatAccountSyncDate(value: string | null): string {
  if (!value) return "暂无同步记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无同步记录";
  return date.toLocaleString("zh-CN");
}

function accountAvatarUrl(user: User): string {
  const value = String(
    user.user_metadata?.account_avatar_url
    ?? user.user_metadata?.avatar_data_url
    ?? user.user_metadata?.avatar_url
    ?? ""
  ).trim();
  return /^(?:https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(value) ? value : "";
}

async function resizeAccountAvatar(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取这张图片。"));
      element.src = objectUrl;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("图片尺寸无效。");
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理头像图片。");
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("头像图片压缩失败。"));
      }, "image/jpeg", 0.82);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
