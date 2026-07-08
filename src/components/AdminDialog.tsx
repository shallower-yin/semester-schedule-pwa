import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, Save, UsersRound } from "lucide-react";
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
  const [userQuery, setUserQuery] = useState("");
  const [directIdentifier, setDirectIdentifier] = useState("");

  const selectedUser = useMemo(
    () => summary?.users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, summary]
  );
  const visibleUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return summary?.users ?? [];
    return (summary?.users ?? []).filter((user) =>
      `${user.email}\n${user.id}\n${user.aiAccess?.note ?? ""}`.toLowerCase().includes(query)
    );
  }, [summary?.users, userQuery]);

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

  async function toggleDetails(userId: string) {
    if (details?.user.id === userId && !detailLoading) {
      setDetails(null);
      return;
    }
    await loadDetails(userId);
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    setDetails(null);
  }

  async function saveAccess() {
    const identifier = directIdentifier.trim();
    if (!selectedUserId && !identifier) {
      setMessage("请选择用户，或输入邮箱/UID 后再保存权限。");
      return;
    }
    setSavingAccess(true);
    setMessage("");
    try {
      const targetUserId = identifier ? (isLikelyUuid(identifier) ? identifier : undefined) : selectedUserId;
      const targetEmail = identifier && !isLikelyUuid(identifier) ? identifier : undefined;
      await saveAdminAiAccess({
        targetUserId,
        targetEmail,
        enabled: accessEnabled,
        role: accessRole,
        expiresAt: accessExpiresAt || null,
        note: accessNote || null
      });
      setDirectIdentifier("");
      await loadSummary();
      setMessage("AI 权限已保存。");
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
    const access = selectedUser?.aiAccess ?? details?.aiAccess ?? null;
    setAccessEnabled(Boolean(access?.enabled));
    setAccessRole(access?.role ?? "member");
    setAccessExpiresAt(access?.expires_at ? access.expires_at.slice(0, 16) : "");
    setAccessNote(access?.note ?? "");
  }, [selectedUser?.aiAccess, details?.aiAccess]);

  return (
    <Modal title="管理后台" onClose={onClose} wide>
      <div className="admin-dialog">
        <div className="admin-toolbar">
          <span><UsersRound size={17} /> {summary?.users.length ?? 0} 个账号</span>
          <input value={userQuery} placeholder="搜索邮箱或 UID" onChange={(event) => setUserQuery(event.target.value)} />
          <button className="button secondary compact" onClick={() => void loadSummary()} disabled={loading}>
            <RefreshCw size={16} />刷新
          </button>
        </div>

        {message && <p className="status-message">{message}</p>}

        <section className="admin-access-editor admin-direct-access">
          <div className="section-heading">
            <div><h3><KeyRound size={18} /> 直接授权</h3><p>输入邮箱或 UID，可直接开通会员或管理员权限。</p></div>
          </div>
          <div className="form-grid">
            <label>
              邮箱或 UID
              <input value={directIdentifier} onChange={(event) => setDirectIdentifier(event.target.value)} placeholder="user@example.com 或 UUID" />
            </label>
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
              <input value={accessNote} onChange={(event) => setAccessNote(event.target.value)} placeholder="例如：充值开通、手动赠送、本人账号" />
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" onClick={() => void saveAccess()} disabled={savingAccess}>
              <Save size={16} />保存权限
            </button>
          </div>
        </section>

        <div className="admin-layout">
          <section className="admin-user-list" aria-label="用户列表">
            {loading && !summary ? <p>正在读取用户列表...</p> : visibleUsers.map((user) => (
              <button
                key={user.id}
                className={user.id === selectedUserId ? "admin-user-card active" : "admin-user-card"}
                onClick={() => selectUser(user.id)}
              >
                <span>
                  <strong>{user.email || "未显示邮箱"}</strong>
                  <small>{user.id}</small>
                </span>
                <span className={accessBadgeClass(user.aiAccess)}>{accessLabel(user.aiAccess)}</span>
                <small>
                  课程 {user.counts.courses} · 事项 {user.counts.events} · 习惯 {user.counts.habits} · 纪念日 {user.counts.anniversaries}
                </small>
                <small>
                  AI {user.aiUsage.requestCount} 次 · {formatTokenCount(user.aiUsage.totalTokens)} tokens · 最近 {formatDateTime(user.aiUsage.lastUsedAt)}
                </small>
              </button>
            ))}
            {summary && !visibleUsers.length && <p>没有匹配账号。</p>}
          </section>

          <section className="admin-detail-panel">
            {selectedUser ? (
              <>
                <header className="admin-detail-header">
                  <div>
                    <h3>{selectedUser.email || "用户详情"}</h3>
                    <p>{selectedUser.id}</p>
                  </div>
                  <button className="button secondary compact" onClick={() => void toggleDetails(selectedUser.id)} disabled={detailLoading}>
                    {details?.user.id === selectedUser.id ? <EyeOff size={16} /> : <Eye size={16} />}
                    {detailLoading ? "读取中" : details?.user.id === selectedUser.id ? "隐藏数据" : "查看数据"}
                  </button>
                </header>

                <section className="admin-access-editor">
                  <div className="section-heading">
                    <div><h3><KeyRound size={18} /> AI 助手权限</h3><p>会员可直接使用 AI 助手；管理员可进入管理后台。</p></div>
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
                      <input value={accessNote} onChange={(event) => setAccessNote(event.target.value)} placeholder="例如：充值开通、手动赠送、本人账号" />
                    </label>
                  </div>
                  <div className="form-actions">
                    <button className="button primary" onClick={() => void saveAccess()} disabled={savingAccess}>
                      <Save size={16} />保存权限
                    </button>
                  </div>
                </section>

                <div className="admin-stats-grid admin-ai-usage-grid">
                  <article><strong>{selectedUser.aiUsage.requestCount}</strong><span>AI 使用次数</span></article>
                  <article><strong>{formatTokenCount(selectedUser.aiUsage.totalTokens)}</strong><span>tokens</span></article>
                  <article><strong>{formatCost(selectedUser.aiUsage.estimatedCostCny)}</strong><span>估算费用</span></article>
                  <article><strong>{formatDateTime(selectedUser.aiUsage.lastUsedAt)}</strong><span>最近使用</span></article>
                </div>

                {detailLoading ? <p>正在读取用户数据...</p> : details && details.user.id === selectedUser.id && (
                  <>
                    <div className="admin-stats-grid">
                      <article><strong>{selectedUser.counts.semesters}</strong><span>学期</span></article>
                      <article><strong>{selectedUser.counts.courses}</strong><span>课程</span></article>
                      <article><strong>{selectedUser.counts.events}</strong><span>事项</span></article>
                      <article><strong>{selectedUser.counts.habits}</strong><span>习惯</span></article>
                      <article><strong>{selectedUser.counts.anniversaries}</strong><span>纪念日</span></article>
                      <article><strong>{selectedUser.counts.memos}</strong><span>备忘录</span></article>
                      <article><strong>{selectedUser.counts.focusSessions}</strong><span>专注</span></article>
                    </div>
                    <div className="admin-data-sections">
                      <AdminRecordSection title="课程" records={details.data.courses} fields={["name", "teacher", "classroom", "note"]} />
                      <AdminRecordSection title="事项/习惯" records={details.data.events} fields={["title", "event_type", "start_date", "end_date", "note"]} />
                      <AdminRecordSection title="纪念日" records={details.data.anniversaries} fields={["title", "kind", "date", "note"]} />
                      <AdminRecordSection title="备忘录" records={details.data.memos} fields={["title", "content"]} />
                      <AdminRecordSection title="专注记录" records={details.data.focusSessions} fields={["task_title", "mode", "duration_seconds", "started_at"]} />
                    </div>
                  </>
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

function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}

function formatCost(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value === 0) return "￥0";
  return `￥${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "从未";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
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
