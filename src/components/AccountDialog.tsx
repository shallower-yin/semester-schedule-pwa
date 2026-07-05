import type { User } from "@supabase/supabase-js";
import { CheckCircle2, Cloud, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { disableNotificationsForCurrentDevice } from "../lib/notifications";
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
      {message && <p className="auth-message">{message}</p>}
      <div className="form-stack">
        <button className="button primary" disabled={syncing} onClick={() => void onSync()}><Cloud size={17} />{syncing ? "同步中…" : "立即同步"}</button>
        <button className="button secondary" onClick={logout}><LogOut size={17} />退出登录</button>
      </div>
    </Modal>
  );
}
