import { supabase } from "./supabase";
import { defaultAiModel, isSupportedAiModel, type AiProvider, type MimoChannel } from "./aiModels";
import { normalizeAiFeatureQuotas, type AiFeatureQuotas } from "./aiFeatures";

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
  username: string;
  email: string;
  bannedUntil: string | null;
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
  aiSettings: AdminAiSettings;
  aiCallLogs: AdminAiCallLog[];
}

export interface AdminAiCallLog {
  requestedAt: string;
  userId: string;
  username: string;
  email: string;
  featureKey: string;
  status: "running" | "success" | "error";
  model: string;
  diagnosticId: string | null;
  latencyMs: number | null;
  error: string | null;
  details: Record<string, unknown>;
}

export interface AdminAiSettings {
  enabled_for_all: boolean;
  ordinary_daily_limit: number;
  ordinary_weekly_limit: number;
  member_daily_limit: number;
  member_weekly_limit: number;
  provider: "deepseek" | "mimo";
  model: string;
  mimo_channel: MimoChannel;
  feature_quotas: AiFeatureQuotas;
  updated_at: string | null;
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

export interface AdminCleanupResult {
  retentionDays: number;
  cutoff: string;
  targetUserId: string | null;
  aiUsageDeleted: number;
  reminderDeliveriesDeleted: number;
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

interface AdminAccountProfileRow {
  user_id: string;
  username: string | null;
  banned_until: string | null;
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
  const [{ data, error }, settingsResult, profilesResult, callLogsResult] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.rpc("admin_get_ai_settings"),
    supabase.rpc("admin_list_account_profiles"),
    supabase.rpc("admin_list_ai_call_logs", { p_limit: 50 })
  ]);
  if (error) throw new Error(formatAdminError(error.message));
  if (settingsResult.error) throw new Error(formatAdminError(settingsResult.error.message));
  if (profilesResult.error) throw new Error(formatAdminError(profilesResult.error.message));
  if (callLogsResult.error) throw new Error(formatAdminError(callLogsResult.error.message));
  const rows = (Array.isArray(data) ? data as AdminListUserRow[] : [])
    .filter((row) => !isSmokeTestAccount(row.email));
  const profiles = new Map(
    (Array.isArray(profilesResult.data) ? profilesResult.data as AdminAccountProfileRow[] : [])
      .map((row) => [row.user_id, row] as const)
  );
  return {
    passwordVisible: false,
    aiSettings: normalizeAiSettings(settingsResult.data),
    aiCallLogs: normalizeAiCallLogs(callLogsResult.data),
    users: rows.map((row) => ({
      id: row.id,
      username: profiles.get(row.id)?.username?.trim() ?? "",
      email: row.email ?? "",
      bannedUntil: profiles.get(row.id)?.banned_until ?? null,
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

function isSmokeTestAccount(email: string | null | undefined): boolean {
  return /^codex-[a-z0-9-]+-smoke@example\.com$/i.test(email ?? "");
}

export async function saveAdminAiSettings(input: Omit<AdminAiSettings, "updated_at">): Promise<AdminAiSettings> {
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.rpc("admin_set_ai_settings", {
    p_enabled_for_all: input.enabled_for_all,
    p_ordinary_daily_limit: input.ordinary_daily_limit,
    p_ordinary_weekly_limit: input.ordinary_weekly_limit,
    p_member_daily_limit: input.member_daily_limit,
    p_member_weekly_limit: input.member_weekly_limit,
    p_provider: input.provider,
    p_model: input.model,
    p_mimo_channel: input.mimo_channel,
    p_feature_quotas: input.feature_quotas
  });
  if (error) throw new Error(formatAdminError(error.message));
  return normalizeAiSettings(data);
}

function normalizeAiSettings(value: unknown): AdminAiSettings {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const provider: AiProvider = row.provider === "mimo" ? "mimo" : "deepseek";
  const storedModel = typeof row.model === "string" ? row.model.trim() : "";
  const legacy = {
    enabled_for_all: Boolean(row.enabled_for_all),
    ordinary_daily_limit: Math.max(0, Number(row.ordinary_daily_limit ?? row.daily_limit ?? 20)),
    ordinary_weekly_limit: Math.max(0, Number(row.ordinary_weekly_limit ?? row.weekly_limit ?? 100)),
    member_daily_limit: Math.max(0, Number(row.member_daily_limit ?? 50)),
    member_weekly_limit: Math.max(0, Number(row.member_weekly_limit ?? 300))
  };
  const featureQuotas = normalizeAiFeatureQuotas(row.feature_quotas, legacy);
  return {
    enabled_for_all: featureQuotas.assistant.enabled_for_all,
    ordinary_daily_limit: featureQuotas.assistant.ordinary_daily_limit,
    ordinary_weekly_limit: featureQuotas.assistant.ordinary_weekly_limit,
    member_daily_limit: featureQuotas.assistant.member_daily_limit,
    member_weekly_limit: featureQuotas.assistant.member_weekly_limit,
    provider,
    model: isSupportedAiModel(provider, storedModel) ? storedModel : defaultAiModel(provider),
    mimo_channel: row.mimo_channel === "token_plan" ? "token_plan" : "payg",
    feature_quotas: featureQuotas,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null
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
  return {
    ...result,
    user: {
      ...result.user,
      username: result.user.username ?? "",
      bannedUntil: result.user.bannedUntil ?? null
    },
    aiUsage: normalizeAiUsage(result.aiUsage)
  };
}

export async function getAdminAiCallLogs(): Promise<AdminAiCallLog[]> {
  if (!supabase) throw new Error("云端服务未配置，无法读取 AI 调用记录。");
  const { data, error } = await supabase.rpc("admin_list_ai_call_logs", { p_limit: 50 });
  if (error) throw new Error(formatAdminError(error.message));
  return normalizeAiCallLogs(data);
}

export async function setAdminAccountBan(targetUserId: string, banned: boolean): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置，无法管理账号状态。");
  const { data, error } = await supabase.functions.invoke("admin", {
    body: { action: "set-account-ban", targetUserId, banned }
  });
  if (error) throw new Error(error.message || "修改账号状态失败。");
  if (data?.error) throw new Error(String(data.error));
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

export async function cleanupAdminTransientData(retentionDays: number, targetUserId?: string): Promise<AdminCleanupResult> {
  if (!supabase) throw new Error("云端服务未配置，无法使用管理后台。");
  const { data, error } = await supabase.rpc("admin_cleanup_transient_data", {
    p_retention_days: retentionDays,
    p_target_user_id: targetUserId || null
  });
  if (error) throw new Error(formatAdminError(error.message));
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    retentionDays: Number(result.retentionDays ?? retentionDays),
    cutoff: typeof result.cutoff === "string" ? result.cutoff : "",
    targetUserId: typeof result.targetUserId === "string" ? result.targetUserId : null,
    aiUsageDeleted: Number(result.aiUsageDeleted ?? 0),
    reminderDeliveriesDeleted: Number(result.reminderDeliveriesDeleted ?? 0)
  };
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

function normalizeAiCallLogs(value: unknown): AdminAiCallLog[] {
  return (Array.isArray(value) ? value : []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      requestedAt: String(item.requested_at ?? ""),
      userId: String(item.user_id ?? ""),
      username: String(item.username ?? "").trim(),
      email: String(item.email ?? "").trim(),
      featureKey: String(item.feature_key ?? "assistant"),
      status: item.status === "success" ? "success" : item.status === "running" ? "running" : "error",
      model: String(item.model ?? ""),
      diagnosticId: typeof item.diagnostic_id === "string" ? item.diagnostic_id : null,
      latencyMs: item.latency_ms == null ? null : Number(item.latency_ms),
      error: typeof item.error === "string" && item.error.trim() ? item.error : null,
      details: item.diagnostic_details && typeof item.diagnostic_details === "object"
        ? item.diagnostic_details as Record<string, unknown>
        : {}
    };
  });
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
