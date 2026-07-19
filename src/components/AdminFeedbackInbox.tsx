import { Check, MessageSquareText, Paperclip, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  feedbackStatusLabel,
  getRecommendedFeedbackChannel,
  listAdminFeedback,
  openFeedbackAttachment,
  updateAdminFeedback,
  updateRecommendedFeedbackChannel,
  type FeedbackStatus,
  type UserFeedback
} from "../lib/feedback";

export function AdminFeedbackInbox() {
  const [records, setRecords] = useState<UserFeedback[]>([]);
  const [filter, setFilter] = useState<FeedbackStatus | "all">("new");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [recommendedChannel, setRecommendedChannel] = useState("");
  const [savingChannel, setSavingChannel] = useState(false);
  const [message, setMessage] = useState("");
  const visible = useMemo(() => filter === "all" ? records : records.filter((record) => record.status === filter), [filter, records]);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [recordsResult, channelResult] = await Promise.allSettled([listAdminFeedback(), getRecommendedFeedbackChannel()]);
      if (recordsResult.status === "rejected") throw recordsResult.reason;
      setRecords(recordsResult.value);
      if (channelResult.status === "fulfilled") setRecommendedChannel(channelResult.value);
      else setMessage(channelResult.reason instanceof Error ? channelResult.reason.message : "读取推荐反馈渠道失败。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取反馈失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function changeRecord(id: string, patch: Partial<UserFeedback>) {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  }

  async function save(record: UserFeedback) {
    setSavingId(record.id);
    setMessage("");
    try {
      await updateAdminFeedback({ id: record.id, status: record.status, adminReply: record.admin_reply });
      setMessage("反馈处理状态已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存反馈失败。");
    } finally {
      setSavingId("");
    }
  }

  async function saveRecommendedChannel() {
    setSavingChannel(true);
    setMessage("");
    try {
      setRecommendedChannel(await updateRecommendedFeedbackChannel(recommendedChannel));
      setMessage("推荐反馈渠道已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存推荐反馈渠道失败。");
    } finally {
      setSavingChannel(false);
    }
  }

  return (
    <section className="admin-access-editor admin-feedback-inbox">
      <div className="section-heading">
        <div><h3><MessageSquareText size={18} /> 用户反馈</h3><p>正文记录在数据库，图片和文档保存在私有 Storage。</p></div>
        <button className="button secondary compact" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />刷新</button>
      </div>
      <div className="admin-feedback-channel-editor">
        <label><span>推荐反馈渠道</span><input maxLength={300} value={recommendedChannel} placeholder="例如：QQ邮箱、微信或其他联系方式" onChange={(event) => setRecommendedChannel(event.target.value)} /></label>
        <button className="button primary compact" disabled={savingChannel} onClick={() => void saveRecommendedChannel()}><Save size={15} />{savingChannel ? "保存中" : "保存"}</button>
      </div>
      <div className="admin-feedback-toolbar">
        {(["new", "reviewed", "resolved", "all"] as const).map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status === "all" ? `全部 ${records.length}` : `${feedbackStatusLabel(status)} ${records.filter((record) => record.status === status).length}`}</button>)}
      </div>
      {message && <p className="status-message">{message}</p>}
      <div className="admin-feedback-list">
        {visible.map((record) => (
          <article key={record.id}>
            <header><strong>{record.user_email || record.user_id}</strong><time>{formatFeedbackTime(record.created_at)}</time></header>
            <p>{record.content}</p>
            {record.attachments.length > 0 && <div className="feedback-record-attachments">{record.attachments.map((attachment) => <button key={attachment.path} onClick={() => void openFeedbackAttachment(attachment.path)}><Paperclip size={13} />{attachment.name}</button>)}</div>}
            <div className="admin-feedback-editor">
              <select aria-label={`处理状态 ${record.user_email}`} value={record.status} onChange={(event) => changeRecord(record.id, { status: event.target.value as FeedbackStatus })}>
                <option value="new">新反馈</option><option value="reviewed">处理中</option><option value="resolved">已处理</option>
              </select>
              <textarea aria-label={`回复 ${record.user_email}`} value={record.admin_reply} placeholder="管理员回复（可选）" onChange={(event) => changeRecord(record.id, { admin_reply: event.target.value })} />
              <button className="button primary compact" disabled={savingId === record.id} onClick={() => void save(record)}>{record.status === "resolved" ? <Check size={15} /> : <Save size={15} />}{savingId === record.id ? "保存中" : "保存"}</button>
            </div>
          </article>
        ))}
        {!loading && !visible.length && <p className="muted-note">当前分类没有反馈。</p>}
      </div>
    </section>
  );
}

function formatFeedbackTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
