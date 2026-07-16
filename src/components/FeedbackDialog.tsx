import { FileText, Image as ImageIcon, LogIn, MessageSquareText, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  feedbackStatusLabel,
  formatFeedbackFileSize,
  listMyFeedback,
  openFeedbackAttachment,
  submitFeedback,
  type UserFeedback
} from "../lib/feedback";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";

interface FeedbackDialogProps {
  userId: string | null;
  userEmail?: string | null;
  onRequestLogin: () => void;
  onClose: () => void;
}

export function FeedbackDialog({ userId, userEmail, onRequestLogin, onClose }: FeedbackDialogProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [records, setRecords] = useState<UserFeedback[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) return;
    void listMyFeedback(userId).then(setRecords).catch((error) => setMessage(error instanceof Error ? error.message : "读取反馈失败。"));
  }, [userId]);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setFiles((current) => [...current, ...Array.from(fileList)].slice(0, 3));
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!userId) return;
    setLoading(true);
    setMessage("");
    try {
      const record = await submitFeedback({ userId, userEmail, content, files });
      setRecords((current) => [record, ...current]);
      setContent("");
      setFiles([]);
      setMessage("反馈已提交，管理员可以在后台查看。");
      showToast("反馈已提交。", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交反馈失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="意见反馈" onClose={onClose} wide>
      {!userId ? (
        <div className="feedback-login-state">
          <MessageSquareText size={38} />
          <h3>登录后提交反馈</h3>
          <p>反馈和附件需要绑定账号，避免他人查看或滥用上传通道。</p>
          <button className="button primary" onClick={onRequestLogin}><LogIn size={16} />登录账号</button>
        </div>
      ) : (
        <div className="feedback-dialog">
          <section className="feedback-composer">
            <label>反馈内容
              <textarea value={content} maxLength={4000} placeholder="请描述遇到的问题、期望结果或改进建议" onChange={(event) => setContent(event.target.value)} />
            </label>
            <div className="feedback-attachment-list">
              {files.map((file, index) => (
                <span key={`${file.name}-${file.lastModified}`}>
                  {file.type.startsWith("image/") ? <ImageIcon size={15} /> : <FileText size={15} />}
                  <strong>{file.name}</strong><small>{formatFeedbackFileSize(file.size)}</small>
                  <button className="icon-button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button>
                </span>
              ))}
            </div>
            <div className="feedback-actions">
              <input ref={inputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => addFiles(event.target.files)} />
              <button className="button secondary" disabled={loading || files.length >= 3} onClick={() => inputRef.current?.click()}><Paperclip size={16} />附件 {files.length}/3</button>
              <button className="button primary" disabled={loading || content.trim().length < 2} onClick={() => void submit()}><Send size={16} />{loading ? "提交中" : "提交反馈"}</button>
            </div>
            <p className="form-hint">附件存入私有文件空间，不写入日程数据库；单个文件不超过 10 MB。</p>
            {message && <p className="status-message">{message}</p>}
          </section>

          <section className="feedback-history">
            <div className="section-heading"><div><h3>我的反馈</h3><p>管理员回复后会显示在对应记录中。</p></div></div>
            {records.map((record) => (
              <article key={record.id}>
                <header><span className={`feedback-status ${record.status}`}>{feedbackStatusLabel(record.status)}</span><time>{formatFeedbackTime(record.created_at)}</time></header>
                <p>{record.content}</p>
                {record.attachments.length > 0 && <div className="feedback-record-attachments">{record.attachments.map((attachment) => <button key={attachment.path} onClick={() => void openFeedbackAttachment(attachment.path)}><Paperclip size={13} />{attachment.name}</button>)}</div>}
                {record.admin_reply && <blockquote><strong>管理员回复</strong>{record.admin_reply}</blockquote>}
              </article>
            ))}
            {!records.length && <p className="muted-note">还没有提交过反馈。</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

function formatFeedbackTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
