import { supabase } from "./supabase";

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
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.functions.invoke<T>("admin", { body });
  if (error) throw new Error(error.message || "管理后台请求失败。");
  return data as T;
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
