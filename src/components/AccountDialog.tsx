import type { User } from "@supabase/supabase-js";
import { BellRing, CheckCircle2, Cloud, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  disableNotificationsForCurrentDevice,
  enableNotifications,
  getNotificationStatus,
  type NotificationStatus
} from "../lib/notifications";
import type { SyncResult } from "../lib/sync";
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
  const [enablingNotifications, setEnablingNotifications] = useState(false);

  useEffect(() => {
    void getNotificationStatus().then(setNotificationStatus);
  }, []);

  async function activateNotifications() {
    setEnablingNotifications(true);
    setNotificationMessage("");
    try {
      const result = await enableNotifications();
      setNotificationStatus(await getNotificationStatus());
      if (result === "denied") setNotificationMessage("浏览器已阻止通知，请在网站权限中改为允许。");
      else if (result === "unsupported") setNotificationMessage("当前浏览器不支持系统通知。");
      else if (result === "local-only") setNotificationMessage("只能在应用打开时提醒，请确认已登录并联网。");
      else setNotificationMessage("当前设备已订阅系统提醒。");
    } catch (error) {
      setNotificationStatus(await getNotificationStatus());
      setNotificationMessage(error instanceof Error ? error.message : "启用提醒失败");
    } finally {
      setEnablingNotifications(false);
    }
  }

  const notificationLabel = {
    unsupported: "浏览器不支持",
    "not-allowed": "尚未允许",
    blocked: "已被浏览器阻止",
    "local-only": "仅应用打开时提醒",
    "permission-only": "已允许，但未完成云端订阅",
    subscribed: "当前设备已订阅"
  }[notificationStatus ?? "not-allowed"];

  async function logout() {
    await disableNotificationsForCurrentDevice();
    await supabase?.auth.signOut();
    onClose();
  }

  return (
    <Modal title="账号与同步" onClose={onClose}>
      <div className="account-summary">
        <div className="account-avatar">{user.email?.slice(0, 1).toUpperCase() ?? "U"}</div>
        <div>
          <strong>{user.email}</strong>
          <span><CheckCircle2 size={14} />{user.email_confirmed_at ? "邮箱已验证" : "等待邮箱验证"}</span>
        </div>
      </div>
      <div className="sync-detail-card">
        <div><span>待上传</span><strong>{pendingChanges} 条</strong></div>
        <div><span>上次同步</span><strong>{lastSync ? new Date(lastSync).toLocaleString("zh-CN") : "尚未同步"}</strong></div>
      </div>
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
      {notificationMessage && <p className="auth-message">{notificationMessage}</p>}
      {message && <p className="auth-message">{message}</p>}
      <div className="form-stack">
        <button className="button primary" disabled={syncing} onClick={() => void onSync()}><Cloud size={17} />{syncing ? "同步中…" : "立即同步"}</button>
        <button className="button secondary" onClick={logout}><LogOut size={17} />退出登录</button>
      </div>
    </Modal>
  );
}
