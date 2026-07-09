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

export interface AdminAiUsage {
  requestCount: number;
  successCount: number;
  errorCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCny: number | null;
  lastUsedAt: string | null;
  today: AdminAiUsagePeriod;
  month: AdminAiUsagePeriod;
}

export interface AdminAiUsagePeriod {
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  estimatedCostCny: number | null;
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
  aiUsage: AdminAiUsage;
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
  user: Omit<AdminUserSummary, "counts" | "aiAccess" | "aiUsage">;
  aiAccess: AdminAiAccess | null;
  aiUsage: AdminAiUsage;
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
  targetUserId?: string;
  targetEmail?: string;
  enabled: boolean;
  role: AdminRole;
  expiresAt?: string | null;
  note?: string | null;
}

interface AdminListUserRow {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  semesters: number | null;
  courses: number | null;
  events: number | null;
  habits: number | null;
  anniversaries: number | null;
  memos: number | null;
  focus_sessions: number | null;
  ai_user_id: string | null;
  ai_enabled: boolean | null;
  ai_role: AdminRole | null;
  ai_expires_at: string | null;
  ai_note: string | null;
  ai_created_at: string | null;
  ai_updated_at: string | null;
  ai_request_count: number | null;
  ai_success_count: number | null;
  ai_error_count: number | null;
  ai_prompt_tokens: number | null;
  ai_completion_tokens: number | null;
  ai_total_tokens: number | null;
  ai_estimated_cost_cny: number | string | null;
  ai_last_used_at: string | null;
  ai_today_request_count: number | null;
  ai_today_success_count: number | null;
  ai_today_error_count: number | null;
  ai_today_total_tokens: number | null;
  ai_today_estimated_cost_cny: number | string | null;
  ai_month_request_count: number | null;
  ai_month_success_count: number | null;
  ai_month_error_count: number | null;
  ai_month_total_tokens: number | null;
  ai_month_estimated_cost_cny: number | string | null;
}

type AiAccessRpcRow = {
  user_id: string;
  enabled: boolean;
  role: AdminRole;
  expires_at: string | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function getAdminSummary(): Promise<AdminSummary> {
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw new Error(formatAdminError(error.message));
  const rows = Array.isArray(data) ? data as AdminListUserRow[] : [];
  return {
    passwordVisible: false,
    users: rows.map((row) => ({
      id: row.id,
      email: row.email ?? "",
      createdAt: row.created_at ?? null,
      lastSignInAt: row.last_sign_in_at ?? null,
      confirmedAt: row.confirmed_at ?? null,
      counts: {
        semesters: Number(row.semesters ?? 0),
        courses: Number(row.courses ?? 0),
        events: Number(row.events ?? 0),
        habits: Number(row.habits ?? 0),
        anniversaries: Number(row.anniversaries ?? 0),
        memos: Number(row.memos ?? 0),
        focusSessions: Number(row.focus_sessions ?? 0)
      },
      aiAccess: row.ai_user_id ? {
        user_id: row.ai_user_id,
        enabled: Boolean(row.ai_enabled),
        role: row.ai_role === "admin" ? "admin" : "member",
        expires_at: row.ai_expires_at ?? null,
        note: row.ai_note ?? null,
        created_at: row.ai_created_at ?? undefined,
        updated_at: row.ai_updated_at ?? undefined
      } : null,
      aiUsage: normalizeAiUsage({
        requestCount: row.ai_request_count,
        successCount: row.ai_success_count,
        errorCount: row.ai_error_count,
        promptTokens: row.ai_prompt_tokens,
        completionTokens: row.ai_completion_tokens,
        totalTokens: row.ai_total_tokens,
        estimatedCostCny: row.ai_estimated_cost_cny,
        lastUsedAt: row.ai_last_used_at,
        today: {
          requestCount: row.ai_today_request_count,
          successCount: row.ai_today_success_count,
          errorCount: row.ai_today_error_count,
          totalTokens: row.ai_today_total_tokens,
          estimatedCostCny: row.ai_today_estimated_cost_cny
        },
        month: {
          requestCount: row.ai_month_request_count,
          successCount: row.ai_month_success_count,
          errorCount: row.ai_month_error_count,
          totalTokens: row.ai_month_total_tokens,
          estimatedCostCny: row.ai_month_estimated_cost_cny
        }
      })
    }))
  };
}

export async function getAdminStatus(): Promise<AdminStatus> {
  if (!supabase) throw new Error("云端服务未配置，无法读取账号类型。");
  const { data, error } = await supabase.rpc("get_my_ai_access");
  if (error) throw new Error(formatAdminError(error.message));
  const aiAccess = data ? normalizeAiAccess(data as AiAccessRpcRow) : null;
  return { isAdmin: isActiveAdmin(aiAccess), aiAccess };
}

export async function getAdminUserDetails(targetUserId: string): Promise<AdminUserDetails> {
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.rpc("admin_get_user_details", { p_target_user_id: targetUserId });
  if (error) throw new Error(formatAdminError(error.message));
  const result = data as AdminUserDetails;
  return { ...result, aiUsage: normalizeAiUsage(result.aiUsage) };
}

export async function saveAdminAiAccess(input: SaveAdminAccessInput): Promise<{ aiAccess: AdminAiAccess | null }> {
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.rpc("admin_set_ai_access", {
    p_target_user_id: input.targetUserId || null,
    p_target_email: input.targetEmail || null,
    p_enabled: input.enabled,
    p_role: input.role,
    p_expires_at: input.expiresAt || null,
    p_note: input.note || null
  });
  if (error) throw new Error(formatAdminError(error.message));
  return { aiAccess: data ? normalizeAiAccess(data as AiAccessRpcRow) : null };
}

function normalizeAiAccess(row: AiAccessRpcRow): AdminAiAccess {
  return {
    user_id: row.user_id,
    enabled: Boolean(row.enabled),
    role: row.role === "admin" ? "admin" : "member",
    expires_at: row.expires_at ?? null,
    note: row.note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeAiUsage(row: Partial<Record<keyof AdminAiUsage, unknown>> | null | undefined): AdminAiUsage {
  const legacyCost = (row as { estimatedCostUsd?: unknown } | null | undefined)?.estimatedCostUsd;
  const estimatedCostCny = row?.estimatedCostCny ?? legacyCost;
  return {
    requestCount: Number(row?.requestCount ?? 0),
    successCount: Number(row?.successCount ?? 0),
    errorCount: Number(row?.errorCount ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    estimatedCostCny: estimatedCostCny == null ? null : Number(estimatedCostCny),
    lastUsedAt: typeof row?.lastUsedAt === "string" ? row.lastUsedAt : null,
    today: normalizeAiUsagePeriod((row as { today?: unknown } | null | undefined)?.today),
    month: normalizeAiUsagePeriod((row as { month?: unknown } | null | undefined)?.month)
  };
}

function normalizeAiUsagePeriod(row: unknown): AdminAiUsagePeriod {
  const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    requestCount: Number(record.requestCount ?? 0),
    successCount: Number(record.successCount ?? 0),
    errorCount: Number(record.errorCount ?? 0),
    totalTokens: Number(record.totalTokens ?? 0),
    estimatedCostCny: record.estimatedCostCny == null ? null : Number(record.estimatedCostCny)
  };
}

function isActiveAdmin(access: AdminAiAccess | null): boolean {
  if (!access?.enabled || access.role !== "admin") return false;
  return !access.expires_at || new Date(access.expires_at).getTime() > Date.now();
}

function formatAdminError(message: string): string {
  if (message.includes("当前账号没有管理权限")) return "当前账号没有管理权限。";
  if (message.includes("没有找到该邮箱对应的账号")) return "没有找到该邮箱对应的账号。";
  if (message.includes("没有找到该用户")) return "没有找到该用户。";
  if (message.includes("权限角色无效")) return "权限角色无效。";
  return message || "管理后台请求失败。";
}
