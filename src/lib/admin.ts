import { supabase, supabasePublishableKey, supabaseUrl } from "./supabase";

export type AdminRole = "member" | "admin";

export interface AdminAiAccess {
  user_id: string;
  enabled: boolean;
  role: AdminRole;
  expires_at: string | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdminUserCounts {
  semesters: number;
  courses: number;
  events: number;
  habits: number;
  anniversaries: number;
  memos: number;
  focusSessions: number;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  confirmedAt: string | null;
  counts: AdminUserCounts;
  aiAccess: AdminAiAccess | null;
}

export interface AdminSummary {
  passwordVisible: false;
  users: AdminUserSummary[];
}

export interface AdminStatus {
  isAdmin: boolean;
  aiAccess: AdminAiAccess | null;
}

export interface AdminUserDetails {
  passwordVisible: false;
  user: Omit<AdminUserSummary, "counts" | "aiAccess">;
  aiAccess: AdminAiAccess | null;
  data: {
    semesters: Array<Record<string, unknown>>;
    courses: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    anniversaries: Array<Record<string, unknown>>;
    memos: Array<Record<string, unknown>>;
    focusSessions: Array<Record<string, unknown>>;
  };
}

export interface SaveAdminAccessInput {
  targetUserId: string;
  enabled: boolean;
  role: AdminRole;
  expiresAt?: string | null;
  note?: string | null;
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase || !supabaseUrl || !supabasePublishableKey) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("登录状态读取失败，请重新登录。");
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录管理员账号。");

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabasePublishableKey,
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const payload = parseAdminResponse(text);
  if (!response.ok) {
    const errorPayload = payload as { error?: unknown; message?: unknown } | null;
    const message = typeof errorPayload?.error === "string"
      ? errorPayload.error
      : typeof errorPayload?.message === "string"
        ? errorPayload.message
        : `管理后台请求失败（${response.status}）。`;
    throw new Error(message);
  }
  return payload as T;
}

function parseAdminResponse(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

export function getAdminSummary(): Promise<AdminSummary> {
  return invokeAdmin<AdminSummary>({ action: "summary" });
}

export function getAdminStatus(): Promise<AdminStatus> {
  return invokeAdmin<AdminStatus>({ action: "whoami" });
}

export function getAdminUserDetails(targetUserId: string): Promise<AdminUserDetails> {
  return invokeAdmin<AdminUserDetails>({ action: "details", targetUserId });
}

export function saveAdminAiAccess(input: SaveAdminAccessInput): Promise<{ aiAccess: AdminAiAccess | null }> {
  return invokeAdmin<{ aiAccess: AdminAiAccess | null }>({
    action: "set-ai-access",
    targetUserId: input.targetUserId,
    access: {
      enabled: input.enabled,
      role: input.role,
      expiresAt: input.expiresAt || null,
      note: input.note || null
    }
  });
}
