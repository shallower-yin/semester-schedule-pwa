import { useEffect, useMemo, useState } from "react";
import { Eye, KeyRound, RefreshCw, Save, ShieldCheck, UsersRound } from "lucide-react";
import {
  getAdminSummary,
  getAdminUserDetails,
  saveAdminAiAccess,
  type AdminAiAccess,
  type AdminRole,
  type AdminSummary,
  type AdminUserDetails,
  type AdminUserSummary
} from "../lib/admin";
import { Modal } from "./Modal";

interface AdminDialogProps {
  onClose: () => void;
}

export function AdminDialog({ onClose }: AdminDialogProps) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [details, setDetails] = useState<AdminUserDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [message, setMessage] = useState("");
  const [accessEnabled, setAccessEnabled] = useState(false);
  const [accessRole, setAccessRole] = useState<AdminRole>("member");
  const [accessExpiresAt, setAccessExpiresAt] = useState("");
  const [accessNote, setAccessNote] = useState("");

  const selectedUser = useMemo(
    () => summary?.users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, summary]
  );

  async function loadSummary() {
    setLoading(true);
    setMessage("");
    try {
      const nextSummary = await getAdminSummary();
      setSummary(nextSummary);
      if (!selectedUserId && nextSummary.users[0]) setSelectedUserId(nextSummary.users[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取管理员数据失败。");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(userId: string) {
    if (!userId) return;
    setDetailLoading(true);
    setMessage("");
    try {
      setDetails(await getAdminUserDetails(userId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取用户数据失败。");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveAccess() {
    if (!selectedUserId) return;
    setSavingAccess(true);
    setMessage("");
    try {
      await saveAdminAiAccess({
        targetUserId: selectedUserId,
        enabled: accessEnabled,
        role: accessRole,
        expiresAt: accessExpiresAt || null,
        note: accessNote || null
      });
      setMessage("AI 权限已保存。");
      await loadSummary();
      await loadDetails(selectedUserId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存 AI 权限失败。");
    } finally {
      setSavingAccess(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    void loadDetails(selectedUserId);
  }, [selectedUserId]);

  useEffect(() => {
    const access = details?.aiAccess ?? selectedUser?.aiAccess ?? null;
    setAccessEnabled(Boolean(access?.enabled));
    setAccessRole(access?.role ?? "member");
    setAccessExpiresAt(access?.expires_at ? access.expires_at.slice(0, 16) : "");
    setAccessNote(access?.note ?? "");
  }, [details?.aiAccess, selectedUser?.aiAccess]);

  return (
    <Modal title="管理后台" onClose={onClose} wide>
      <div className="admin-dialog">
        <section className="admin-notice">
          <ShieldCheck size={22} />
          <div>
            <strong>账号与权限管理</strong>
            <p>查看账号概览、核对应用数据，并为指定账号配置 AI 助手与管理权限。</p>
          </div>
        </section>

        <div className="admin-toolbar">
          <span><UsersRound size={17} /> {summary?.users.length ?? 0} 个账号</span>
          <button className="button secondary compact" onClick={() => void loadSummary()} disabled={loading}>
            <RefreshCw size={16} />刷新
          </button>
        </div>

        {message && <p className="status-message">{message}</p>}

        <div className="admin-layout">
          <section className="admin-user-list" aria-label="用户列表">
            {loading && !summary ? <p>正在读取用户列表...</p> : summary?.users.map((user) => (
              <button
                key={user.id}
                className={user.id === selectedUserId ? "admin-user-card active" : "admin-user-card"}
                onClick={() => setSelectedUserId(user.id)}
              >
                <span>
                  <strong>{user.email || "未显示邮箱"}</strong>
                  <small>{user.id}</small>
                </span>
                <span className={accessBadgeClass(user.aiAccess)}>{accessLabel(user.aiAccess)}</span>
                <small>
                  课程 {user.counts.courses} · 事项 {user.counts.events} · 习惯 {user.counts.habits} · 纪念日 {user.counts.anniversaries}
                </small>
              </button>
            ))}
          </section>

          <section className="admin-detail-panel">
            {selectedUser ? (
              <>
                <header className="admin-detail-header">
                  <div>
                    <h3>{selectedUser.email || "用户详情"}</h3>
                    <p>{selectedUser.id}</p>
                  </div>
                  <button className="button secondary compact" onClick={() => void loadDetails(selectedUser.id)} disabled={detailLoading}>
                    <Eye size={16} />查看数据
                  </button>
                </header>

                <div className="admin-stats-grid">
                  <article><strong>{selectedUser.counts.semesters}</strong><span>学期</span></article>
                  <article><strong>{selectedUser.counts.courses}</strong><span>课程</span></article>
                  <article><strong>{selectedUser.counts.events}</strong><span>事项</span></article>
                  <article><strong>{selectedUser.counts.habits}</strong><span>习惯</span></article>
                  <article><strong>{selectedUser.counts.anniversaries}</strong><span>纪念日</span></article>
                  <article><strong>{selectedUser.counts.memos}</strong><span>备忘录</span></article>
                  <article><strong>{selectedUser.counts.focusSessions}</strong><span>专注</span></article>
                </div>

                <section className="admin-access-editor">
                  <div className="section-heading">
                    <div><h3><KeyRound size={18} /> AI 助手权限</h3><p>控制 AI 助手使用权限和管理后台入口。</p></div>
                  </div>
                  <div className="form-grid">
                    <label>
                      启用
                      <select value={accessEnabled ? "1" : "0"} onChange={(event) => setAccessEnabled(event.target.value === "1")}>
                        <option value="1">启用</option>
                        <option value="0">关闭</option>
                      </select>
                    </label>
                    <label>
                      角色
                      <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as AdminRole)}>
                        <option value="member">会员</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                    <label>
                      到期时间
                      <input type="datetime-local" value={accessExpiresAt} onChange={(event) => setAccessExpiresAt(event.target.value)} />
                    </label>
                    <label>
                      备注
                      <input value={accessNote} onChange={(event) => setAccessNote(event.target.value)} placeholder="例如：本人账号、临时开通" />
                    </label>
                  </div>
                  <div className="form-actions">
                    <button className="button primary" onClick={() => void saveAccess()} disabled={savingAccess}>
                      <Save size={16} />保存权限
                    </button>
                  </div>
                </section>

                {detailLoading ? <p>正在读取用户数据...</p> : details && (
                  <div className="admin-data-sections">
                    <AdminRecordSection title="课程" records={details.data.courses} fields={["name", "teacher", "classroom", "note"]} />
                    <AdminRecordSection title="事项/习惯" records={details.data.events} fields={["title", "event_type", "start_date", "end_date", "note"]} />
                    <AdminRecordSection title="纪念日" records={details.data.anniversaries} fields={["title", "kind", "date", "note"]} />
                    <AdminRecordSection title="备忘录" records={details.data.memos} fields={["title", "content"]} />
                    <AdminRecordSection title="专注记录" records={details.data.focusSessions} fields={["task_title", "mode", "duration_seconds", "started_at"]} />
                  </div>
                )}
              </>
            ) : (
              <p>请选择一个用户。</p>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}

function AdminRecordSection({ title, records, fields }: { title: string; records: Array<Record<string, unknown>>; fields: string[] }) {
  return (
    <section className="admin-record-section">
      <div className="section-heading">
        <div><h3>{title}</h3><p>{records.length} 条</p></div>
      </div>
      <div className="admin-record-list">
        {records.length ? records.slice(0, 20).map((record, index) => (
          <article key={String(record.id ?? index)}>
            {fields.map((field) => (
              <span key={field}>
                <strong>{fieldLabel(field)}：</strong>{recordValue(record[field])}
              </span>
            ))}
          </article>
        )) : <p>暂无数据。</p>}
        {records.length > 20 && <p>仅显示最近 20 条。</p>}
      </div>
    </section>
  );
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    name: "名称",
    teacher: "教师",
    classroom: "教室",
    note: "备注",
    title: "标题",
    event_type: "类型",
    start_date: "开始",
    end_date: "结束",
    kind: "类型",
    date: "日期",
    content: "内容",
    task_title: "任务",
    mode: "模式",
    duration_seconds: "秒数",
    started_at: "开始"
  };
  return labels[field] ?? field;
}

function recordValue(value: unknown): string {
  if (value == null || value === "") return "-";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  return String(value);
}

function accessLabel(access: AdminAiAccess | null): string {
  if (!access?.enabled) return "未开通";
  if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) return "已到期";
  return access.role === "admin" ? "管理员" : "会员";
}

function accessBadgeClass(access: AdminAiAccess | null): string {
  const label = accessLabel(access);
  return label === "管理员" ? "admin-access-badge admin" : label === "会员" ? "admin-access-badge member" : "admin-access-badge";
}
