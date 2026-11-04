import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CheckCircle2, Database, Eye, EyeOff, KeyRound, RefreshCw, Save, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import {
  cleanupAdminTransientData,
  getAdminAiCallLogs,
  getAdminSummary,
  getAdminUserDetails,
  saveAdminAiAccess,
  setAdminAccountBan,
  type AdminAiAccess,
  type AdminRole,
  type AdminSummary,
  type AdminUserDetails,
  type AdminUserSummary
} from "../lib/admin";
import { Modal } from "./Modal";
import { AdminFocusAudioManager } from "./AdminFocusAudioManager";
import { AdminFeedbackInbox } from "./AdminFeedbackInbox";
import { AdminAiSettingsPanel } from "./AdminAiSettingsPanel";
import { AdminAiRelayManager, useAdminAiRelayManager } from "./AdminAiRelayManager";
import { useAdminAiSettingsDraft } from "./useAdminAiSettingsDraft";

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
  const settingsEditor = useAdminAiSettingsDraft({
    onMessage: setMessage,
    onSaved: (settings) => setSummary((current) => current ? { ...current, aiSettings: settings } : current)
  });
  const relayEditor = useAdminAiRelayManager({
    onMessage: setMessage, onRefresh: loadSummary, onDeleted: settingsEditor.removeRelayReference
  });
  const summaryRequest = useRef(0);
  const detailRequest = useRef(0);
  const accessOwner = useRef<string | null>(null);
  const accessEdited = useRef(false);
  const accessRevision = useRef(0);
  const [cleanupRetentionDays, setCleanupRetentionDays] = useState(90);
  const [cleanupScope, setCleanupScope] = useState<"all" | "selected">("all");
  const [cleaningData, setCleaningData] = useState(false);
  const [adminSection, setAdminSection] = useState<"ai" | "content" | "users">("ai");
  const [changingAccountStatus, setChangingAccountStatus] = useState(false);

  const selectedUser = useMemo(
    () => summary?.users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, summary]
  );
  const visibleUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return summary?.users ?? [];
    return (summary?.users ?? []).filter((user) =>
      `${user.username}\n${user.email}\n${user.aiAccess?.note ?? ""}`.toLowerCase().includes(query)
    );
  }, [summary?.users, userQuery]);

  async function loadSummary() {
    const request = ++summaryRequest.current;
    const settingsVersion = settingsEditor.snapshotVersion();
    setLoading(true);
    setMessage("");
    try {
      const nextSummary = await getAdminSummary();
      if (request !== summaryRequest.current) return;
      const settingsAccepted = settingsEditor.receiveSnapshot(nextSummary.aiSettings, settingsVersion);
      setSummary((current) => ({
        ...nextSummary,
        aiSettings: settingsAccepted ? nextSummary.aiSettings : current?.aiSettings ?? nextSummary.aiSettings
      }));
      if (!selectedUserId && nextSummary.users[0]) setSelectedUserId(nextSummary.users[0].id);
    } catch (error) {
      if (request === summaryRequest.current) setMessage(error instanceof Error ? error.message : "读取管理员数据失败。");
    } finally {
      if (request === summaryRequest.current) setLoading(false);
    }
  }

  async function loadDetails(userId: string) {
    if (!userId) return;
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setMessage("");
    try {
      const nextDetails = await getAdminUserDetails(userId);
      if (request === detailRequest.current) setDetails(nextDetails);
    } catch (error) {
      if (request === detailRequest.current) setMessage(error instanceof Error ? error.message : "读取用户数据失败。");
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  async function refreshAiCallLogs() {
    try {
      const aiCallLogs = await getAdminAiCallLogs();
      setSummary((current) => current ? { ...current, aiCallLogs } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新 AI 调用记录失败。");
    }
  }

  async function changeAccountStatus() {
    if (!selectedUser) return;
    const isBanned = accountIsBanned(selectedUser.bannedUntil);
    const label = selectedUser.username || selectedUser.email;
    if (!window.confirm(`${isBanned ? "解封" : "封禁"}账号“${label}”？`)) return;
    setChangingAccountStatus(true);
    setMessage("");
    try {
      await setAdminAccountBan(selectedUser.id, !isBanned);
      await loadSummary();
      setMessage(isBanned ? "账号已解封。" : "账号已封禁，后续登录和令牌刷新将被拒绝。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改账号状态失败。");
    } finally {
      setChangingAccountStatus(false);
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
    detailRequest.current += 1;
    setDetailLoading(false);
    setSelectedUserId(userId);
    setDirectIdentifier("");
    setDetails(null);
    // Selecting a user is an explicit target change, even when the selected
    // ID is unchanged after editing an email-addressed direct grant.
    accessOwner.current = userId;
    accessEdited.current = false;
    accessRevision.current += 1;
    resetAccessDraft(summary?.users.find((user) => user.id === userId)?.aiAccess ?? null);
  }

  function resetAccessDraft(access: AdminAiAccess | null) {
    setAccessEnabled(Boolean(access?.enabled));
    setAccessRole(access?.role ?? "member");
    setAccessExpiresAt(access?.expires_at ? access.expires_at.slice(0, 16) : "");
    setAccessNote(access?.note ?? "");
  }

  function editAccess(update: () => void) {
    accessEdited.current = true;
    accessRevision.current += 1;
    update();
  }

  async function saveAccess() {
    const identifier = directIdentifier.trim();
    if (!selectedUserId && !identifier) {
      setMessage("请选择用户，或输入邮箱/账号 ID 后再保存权限。");
      return;
    }
    setSavingAccess(true);
    setMessage("");
    const submittedRevision = accessRevision.current;
    const submittedOwner = accessOwner.current;
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
      const editedDuringSave = accessRevision.current !== submittedRevision || accessOwner.current !== submittedOwner;
      if (!editedDuringSave) {
        accessEdited.current = false;
        setDirectIdentifier((current) => current === directIdentifier ? "" : current);
      }
      await loadSummary();
      setMessage(editedDuringSave ? "AI 权限已保存，后续修改尚未保存。" : "AI 权限已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存 AI 权限失败。");
    } finally {
      setSavingAccess(false);
    }
  }

  async function cleanupTransientData() {
    const retentionDays = Math.min(3650, Math.max(30, Math.round(cleanupRetentionDays)));
    const targetUserId = cleanupScope === "selected" ? selectedUserId : undefined;
    if (cleanupScope === "selected" && !targetUserId) {
      setMessage("请先选择要清理临时记录的用户。");
      return;
    }
    const scopeLabel = targetUserId ? selectedUser?.email || targetUserId : "全部账号";
    if (!window.confirm(`清理${scopeLabel}中 ${retentionDays} 天前的 AI 调用明细和提醒投递日志？事项等长期数据不会删除。`)) return;
    setCleaningData(true);
    setMessage("");
    try {
      const result = await cleanupAdminTransientData(retentionDays, targetUserId);
      await loadSummary();
      setMessage(`清理完成：AI 调用明细 ${result.aiUsageDeleted} 条，提醒投递日志 ${result.reminderDeliveriesDeleted} 条。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理临时数据失败。");
    } finally {
      setCleaningData(false);
    }
  }

  useEffect(() => {
    void loadSummary();
    return () => {
      summaryRequest.current += 1;
      detailRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    if (adminSection !== "ai") return;
    const timer = window.setInterval(() => void refreshAiCallLogs(), 15_000);
    return () => window.clearInterval(timer);
  }, [adminSection]);

  useEffect(() => {
    const ownerId = selectedUser?.id ?? "";
    if (accessOwner.current !== ownerId) {
      accessOwner.current = ownerId;
      accessRevision.current += 1;
      if (!directIdentifier.trim()) accessEdited.current = false;
    }
    if (accessEdited.current) return;
    const access = selectedUser?.aiAccess ?? (details?.user.id === ownerId ? details.aiAccess : null);
    resetAccessDraft(access);
  }, [selectedUser?.id, selectedUser?.aiAccess, details?.user.id, details?.aiAccess]);

  return (
    <Modal title="管理后台" onClose={onClose} wide>
      <div className="admin-dialog">
        <div className="admin-toolbar">
          <span><UsersRound size={17} /> {summary?.users.length ?? 0} 个账号</span>
          <input value={userQuery} placeholder="搜索用户名或邮箱" onChange={(event) => setUserQuery(event.target.value)} />
          <button className="button secondary compact" onClick={() => void loadSummary()} disabled={loading}>
            <RefreshCw size={16} />刷新
          </button>
        </div>

        {message && <p className="status-message">{message}</p>}

        <nav className="admin-section-tabs" aria-label="管理后台分区">
          <button type="button" className={adminSection === "ai" ? "active" : ""} onClick={() => setAdminSection("ai")}><KeyRound size={16} />AI 与权限</button>
          <button type="button" className={adminSection === "content" ? "active" : ""} onClick={() => setAdminSection("content")}><Save size={16} />内容运营</button>
          <button type="button" className={adminSection === "users" ? "active" : ""} onClick={() => setAdminSection("users")}><UsersRound size={16} />用户与清理</button>
        </nav>

        {adminSection === "ai" && <>
          <AdminAiSettingsPanel editor={settingsEditor} relays={summary?.aiRelays ?? []}>
            <AdminAiRelayManager editor={relayEditor} relays={summary?.aiRelays ?? []} />
          </AdminAiSettingsPanel>

          <section className="admin-access-editor admin-direct-access">
          <div className="section-heading">
            <div><h3><KeyRound size={18} /> 直接授权</h3><p>输入邮箱，可直接开通会员或管理员权限。</p></div>
          </div>
          <div className="form-grid admin-direct-access-grid">
            <label>
              邮箱
              <input type="email" value={directIdentifier} onChange={(event) => editAccess(() => setDirectIdentifier(event.target.value))} placeholder="user@example.com" />
            </label>
            <label>
              启用
              <select value={accessEnabled ? "1" : "0"} onChange={(event) => editAccess(() => setAccessEnabled(event.target.value === "1"))}>
                <option value="1">启用</option>
                <option value="0">关闭</option>
              </select>
            </label>
            <label>
              角色
              <select value={accessRole} onChange={(event) => editAccess(() => setAccessRole(event.target.value as AdminRole))}>
                <option value="member">会员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>
              到期时间
              <input type="datetime-local" value={accessExpiresAt} onChange={(event) => editAccess(() => setAccessExpiresAt(event.target.value))} />
            </label>
            <label className="admin-direct-note">
              备注
              <input value={accessNote} onChange={(event) => editAccess(() => setAccessNote(event.target.value))} placeholder="例如：充值开通、手动赠送、本人账号" />
            </label>
            <button className="button primary admin-direct-save" onClick={() => void saveAccess()} disabled={savingAccess}>
              <Save size={16} />保存权限
            </button>
          </div>
          </section>

          <section className="admin-access-editor admin-ai-error-logs">
            <div className="section-heading">
              <div><h3><Database size={18} /> AI 调用记录</h3><p>显示最近 50 条翻译、思维导图与音频转写调用，成功和失败都会记录；AI 助手不显示。列表每 15 秒自动刷新。</p></div>
              <button className="button secondary compact" type="button" onClick={() => void refreshAiCallLogs()}><RefreshCw size={15} />刷新记录</button>
            </div>
            <div className="admin-ai-error-log-list">
              {(summary?.aiCallLogs ?? []).map((log) => (
                <article className={log.status} key={`${log.userId}-${log.requestedAt}-${log.featureKey}`}>
                  <div>
                    <strong>{aiFeatureName(log.featureKey)}</strong>
                    <span className={`admin-call-status ${log.status}`}>{log.status === "success" ? <CheckCircle2 size={13} /> : log.status === "running" ? <RefreshCw size={13} /> : <Ban size={13} />}{log.status === "success" ? "成功" : log.status === "running" ? "处理中" : "失败"}</span>
                    <time>{formatDateTime(log.requestedAt)}</time>
                  </div>
                  <p className="admin-call-user">{log.username || log.email || "未命名用户"}{log.username && log.email ? ` · ${log.email}` : ""}</p>
                  <p>{log.status === "success" ? `调用完成${log.model ? ` · ${log.model}` : ""}` : log.status === "running" ? "调用已发出，正在等待结果" : log.error || "调用失败"}</p>
                  <small>{diagnosticDetailsText(log.details)}{log.latencyMs != null ? ` · ${log.latencyMs} ms` : ""}</small>
                </article>
              ))}
              {summary && !(summary.aiCallLogs ?? []).length && <p className="muted-note">暂无翻译、思维导图或音频转写调用记录。</p>}
            </div>
          </section>
        </>}

        {adminSection === "content" && <>
          <AdminFocusAudioManager />

          <AdminFeedbackInbox />
        </>}

        {adminSection === "users" && <>
          <section className="admin-access-editor admin-data-cleanup">
          <div className="section-heading">
            <div><h3><Database size={18} /> 临时数据清理</h3><p>仅删除过期的 AI 调用明细和提醒投递日志；累计 AI 统计将只保留期限内数据，长期日程数据不受影响。</p></div>
          </div>
          <div className="admin-cleanup-controls">
            <label>
              清理范围
              <select aria-label="清理范围" value={cleanupScope} onChange={(event) => setCleanupScope(event.target.value === "selected" ? "selected" : "all")}>
                <option value="all">全部账号的临时记录</option>
                <option value="selected" disabled={!selectedUserId}>当前选中账号</option>
              </select>
            </label>
            <label>
              保留天数
              <input aria-label="临时数据保留天数" type="number" min={30} max={3650} value={cleanupRetentionDays} onChange={(event) => setCleanupRetentionDays(Number(event.target.value))} />
            </label>
            <button className="button danger-button" onClick={() => void cleanupTransientData()} disabled={cleaningData}>
              <Trash2 size={16} />{cleaningData ? "清理中" : "清理过期记录"}
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
                  <strong>{user.username || user.email || "未命名用户"}</strong>
                  <small>{user.username ? user.email : "尚未设置用户名"}</small>
                </span>
                <span className={accountIsBanned(user.bannedUntil) ? "admin-access-badge banned" : accessBadgeClass(user.aiAccess)}>
                  {accountIsBanned(user.bannedUntil) ? "已封禁" : accessLabel(user.aiAccess)}
                </span>
                <small>
                  AI 今日 {user.aiUsage.today.requestCount} 次 · 本月 {user.aiUsage.month.requestCount} 次 · 累计 {user.aiUsage.requestCount} 次
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
                    <h3>{selectedUser.username || selectedUser.email || "用户详情"}</h3>
                    <p>{selectedUser.email}</p>
                    <small>账号 ID：{selectedUser.id}</small>
                  </div>
                  <div className="admin-account-actions">
                    <button className={accountIsBanned(selectedUser.bannedUntil) ? "button secondary compact" : "button danger-button compact"} onClick={() => void changeAccountStatus()} disabled={changingAccountStatus}>
                      {accountIsBanned(selectedUser.bannedUntil) ? <ShieldCheck size={16} /> : <Ban size={16} />}
                      {changingAccountStatus ? "处理中" : accountIsBanned(selectedUser.bannedUntil) ? "解封账号" : "封禁账号"}
                    </button>
                    <button className="button secondary compact" onClick={() => void toggleDetails(selectedUser.id)} disabled={detailLoading}>
                      {details?.user.id === selectedUser.id ? <EyeOff size={16} /> : <Eye size={16} />}
                      {detailLoading ? "读取中" : details?.user.id === selectedUser.id ? "隐藏数据" : "查看数据"}
                    </button>
                  </div>
                </header>
                {details?.user.id !== selectedUser.id && (
                  <p className="admin-data-note">当前仅显示账号与 AI 权限；点击“查看数据”后再显示该账号的日程数据概览。</p>
                )}

                <section className="admin-access-editor">
                  <div className="section-heading">
                    <div><h3><KeyRound size={18} /> AI 助手权限</h3><p>会员可直接使用 AI 助手；管理员可进入管理后台。</p></div>
                  </div>
                  <div className="form-grid">
                    <label>
                      启用
                      <select value={accessEnabled ? "1" : "0"} onChange={(event) => editAccess(() => setAccessEnabled(event.target.value === "1"))}>
                        <option value="1">启用</option>
                        <option value="0">关闭</option>
                      </select>
                    </label>
                    <label>
                      角色
                      <select value={accessRole} onChange={(event) => editAccess(() => setAccessRole(event.target.value as AdminRole))}>
                        <option value="member">会员</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                    <label>
                      到期时间
                      <input type="datetime-local" value={accessExpiresAt} onChange={(event) => editAccess(() => setAccessExpiresAt(event.target.value))} />
                    </label>
                    <label>
                      备注
                      <input value={accessNote} onChange={(event) => editAccess(() => setAccessNote(event.target.value))} placeholder="例如：充值开通、手动赠送、本人账号" />
                    </label>
                  </div>
                  <div className="form-actions">
                    <button className="button primary" onClick={() => void saveAccess()} disabled={savingAccess}>
                      <Save size={16} />保存权限
                    </button>
                  </div>
                </section>

                <div className="admin-ai-usage-summary">
                  <AiUsageCard title="今日" requests={selectedUser.aiUsage.today.requestCount} tokens={selectedUser.aiUsage.today.totalTokens} cost={selectedUser.aiUsage.today.estimatedCostCny} />
                  <AiUsageCard title="本月" requests={selectedUser.aiUsage.month.requestCount} tokens={selectedUser.aiUsage.month.totalTokens} cost={selectedUser.aiUsage.month.estimatedCostCny} />
                  <AiUsageCard title="累计" requests={selectedUser.aiUsage.requestCount} tokens={selectedUser.aiUsage.totalTokens} cost={selectedUser.aiUsage.estimatedCostCny} />
                  <article className="admin-ai-usage-card">
                    <span>最近使用</span>
                    <strong>{formatDateTime(selectedUser.aiUsage.lastUsedAt)}</strong>
                    <small>成功 {selectedUser.aiUsage.successCount} · 失败 {selectedUser.aiUsage.errorCount}</small>
                  </article>
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
        </>}
      </div>
    </Modal>
  );
}

function AiUsageCard({ title, requests, tokens, cost }: { title: string; requests: number; tokens: number; cost: number | null }) {
  return (
    <article className="admin-ai-usage-card">
      <span>{title}</span>
      <strong>{requests} 次</strong>
      <small>{formatTokenCount(tokens)} · {formatCost(cost)}</small>
    </article>
  );
}

function aiFeatureName(value: string): string {
  if (value === "translation") return "翻译助手";
  if (value === "mind_map") return "AI 思维导图";
  if (value === "audio_transcription") return "AI 音频转写";
  return "AI 助手";
}

function diagnosticDetailsText(details: Record<string, unknown>): string {
  const values = [
    details.stage ? `阶段 ${details.stage}` : "",
    details.providerStatus ? `上游 HTTP ${details.providerStatus}` : "",
    details.providerError ? String(details.providerError) : "",
    details.fileName ? `文件 ${details.fileName}` : "",
    details.chunk ? `分段 ${details.chunk}/${details.chunkCount ?? "?"}` : ""
  ].filter(Boolean);
  return values.join(" · ") || "未记录额外诊断信息";
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

function accountIsBanned(bannedUntil: string | null): boolean {
  if (!bannedUntil) return false;
  const timestamp = new Date(bannedUntil).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}
