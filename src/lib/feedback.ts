import { supabase } from "./supabase";

export type FeedbackStatus = "new" | "reviewed" | "resolved";

export interface FeedbackAttachment {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

export interface UserFeedback {
  id: string;
  user_id: string;
  user_email: string;
  content: string;
  attachments: FeedbackAttachment[];
  status: FeedbackStatus;
  admin_reply: string;
  created_at: string;
  updated_at: string;
}

const FEEDBACK_BUCKET = "feedback-attachments";
const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export async function submitFeedback(input: { userId: string; userEmail?: string | null; content: string; files: File[] }): Promise<UserFeedback> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法提交反馈。");
  const content = input.content.trim();
  if (content.length < 2) throw new Error("请填写至少 2 个字的反馈内容。");
  if (content.length > 4000) throw new Error("反馈内容不能超过 4000 个字。");
  const files = input.files.slice(0, MAX_FILES);
  files.forEach(validateFeedbackFile);
  const feedbackId = crypto.randomUUID();
  const uploaded: FeedbackAttachment[] = [];

  try {
    for (const file of files) {
      const path = `${input.userId}/${feedbackId}/${crypto.randomUUID()}${safeExtension(file.name)}`;
      const { error } = await supabase.storage.from(FEEDBACK_BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false
      });
      if (error) throw new Error(error.message || `上传 ${file.name} 失败。`);
      uploaded.push({ name: file.name, path, mimeType: file.type, size: file.size });
    }

    const { data, error } = await supabase.from("user_feedback").insert({
      id: feedbackId,
      user_id: input.userId,
      user_email: input.userEmail ?? "",
      content,
      attachments: uploaded
    }).select("*").single();
    if (error) throw new Error(error.message || "保存反馈失败。");
    return normalizeFeedback(data);
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(FEEDBACK_BUCKET).remove(uploaded.map((item) => item.path));
    throw error;
  }
}

export async function listMyFeedback(userId: string): Promise<UserFeedback[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("user_feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message || "读取反馈记录失败。");
  return (data ?? []).map(normalizeFeedback);
}

export async function listAdminFeedback(): Promise<UserFeedback[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("user_feedback").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message || "读取用户反馈失败。");
  return (data ?? []).map(normalizeFeedback);
}

export async function updateAdminFeedback(input: { id: string; status: FeedbackStatus; adminReply: string }): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置。");
  const { error } = await supabase.from("user_feedback").update({
    status: input.status,
    admin_reply: input.adminReply.trim(),
    updated_at: new Date().toISOString()
  }).eq("id", input.id);
  if (error) throw new Error(error.message || "更新反馈失败。");
}

export async function openFeedbackAttachment(path: string): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置。");
  const attachmentWindow = window.open("about:blank", "_blank");
  try {
    const { data, error } = await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) throw new Error(error?.message || "附件链接生成失败。");
    if (attachmentWindow) {
      attachmentWindow.opener = null;
      attachmentWindow.location.href = data.signedUrl;
    } else {
      window.location.assign(data.signedUrl);
    }
  } catch (error) {
    attachmentWindow?.close();
    throw error;
  }
}

export function feedbackStatusLabel(status: FeedbackStatus): string {
  if (status === "resolved") return "已处理";
  if (status === "reviewed") return "处理中";
  return "新反馈";
}

export function formatFeedbackFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateFeedbackFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error(`${file.name} 的格式不支持，请上传图片、PDF、TXT 或 Word 文档。`);
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} 超过 10 MB。`);
}

function normalizeFeedback(value: unknown): UserFeedback {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    user_email: String(row.user_email ?? ""),
    content: String(row.content ?? ""),
    attachments: Array.isArray(row.attachments) ? row.attachments.filter(isFeedbackAttachment) : [],
    status: row.status === "resolved" || row.status === "reviewed" ? row.status : "new",
    admin_reply: String(row.admin_reply ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? "")
  };
}

function isFeedbackAttachment(value: unknown): value is FeedbackAttachment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string" && typeof row.path === "string" && typeof row.mimeType === "string" && typeof row.size === "number";
}

function safeExtension(name: string): string {
  return name.toLowerCase().match(/\.[a-z0-9]{1,8}$/)?.[0] ?? "";
}
