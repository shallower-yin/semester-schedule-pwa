type AdminAction = "whoami" | "summary" | "details" | "set-ai-access" | "get-ai-settings" | "set-ai-settings";

interface AdminRequest {
  action?: AdminAction;
  targetUserId?: string;
  targetEmail?: string;
  access?: {
    enabled?: boolean;
    role?: "member" | "admin";
    expiresAt?: string | null;
    note?: string | null;
  };
  settings?: {
    enabledForAll?: boolean;
    ordinaryDailyLimit?: number;
    ordinaryWeeklyLimit?: number;
    memberDailyLimit?: number;
    memberWeeklyLimit?: number;
    provider?: "deepseek" | "mimo";
    model?: string;
    mimoChannel?: "payg" | "token_plan";
  };
}

const ADMIN_AI_MODELS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  mimo: ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.5-pro-ultraspeed"]
} as const;

interface SupabaseUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  confirmed_at?: string | null;
}

interface AiAccessRow {
  user_id: string;
  enabled: boolean;
  role: "member" | "admin";
  expires_at: string | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
}

interface AiUsageRow {
  user_id: string;
  requested_at: string;
  status: "success" | "error";
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_cny: number | string | null;
}

interface AiUsageSummary {
  requestCount: number;
  successCount: number;
  errorCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCny: number | null;
  lastUsedAt: string | null;
  today: AiUsagePeriodSummary;
  month: AiUsagePeriodSummary;
}

interface AiUsagePeriodSummary {
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  estimatedCostCny: number | null;
}

interface UserCounts {
  semesters: number;
  courses: number;
  events: number;
  habits: number;
  anniversaries: number;
  memos: number;
  focusSessions: number;
}

const SUMMARY_TABLES = [
  { table: "semesters", key: "semesters" },
  { table: "courses", key: "courses" },
  { table: "events", key: "events" },
  { table: "anniversaries", key: "anniversaries" },
  { table: "memos", key: "memos" },
  { table: "focus_sessions", key: "focusSessions" }
] as const;

const DETAIL_TABLES = {
  semesters: "id,name,start_date,total_weeks,is_current,updated_at",
  courses: "id,semester_id,name,teacher,classroom,color,note,updated_at",
  events: "id,event_type,title,start_date,start_time,end_date,end_time,all_day,color,location,note,recurrence_type,reminder_enabled,updated_at",
  anniversaries: "id,kind,title,date,color,note,reminder_enabled,reminder_days_before,reminder_time,updated_at",
  memos: "id,title,content,is_pinned,updated_at",
  focus_sessions: "id,mode,task_title,duration_seconds,started_at,ended_at,completed,interrupted"
} as const;

function optionalSecret(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function serviceRoleSecret(): string {
  return optionalSecret("SERVICE_ROLE_KEY") || optionalSecret("SUPABASE_SERVICE_ROLE_KEY");
}

function requiredSecret(name: string): string {
  const value = optionalSecret(name);
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS"
    }
  });
}

const supabaseUrl = requiredSecret("SUPABASE_URL");
const publishableKeys = JSON.parse(requiredSecret("SUPABASE_PUBLISHABLE_KEYS")) as Record<string, string>;
const publishableKey = publishableKeys.default;
if (!publishableKey) throw new Error("Missing default Supabase publishable key");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "请先登录管理员账号。" }, 401);
    }

    const serviceRoleKey = serviceRoleSecret();
    if (!serviceRoleKey) {
      return jsonResponse({
        error: "管理后台未完成配置，请联系管理员。"
      }, 500);
    }

    const user = await getUser(authorization);
    const body = await request.json() as AdminRequest;
    const adminAccess = await getAiAccess(user.id, serviceRoleKey);
    const isAdmin = isActiveAdmin(adminAccess);
    if (body.action === "whoami") {
      return jsonResponse({ isAdmin, aiAccess: adminAccess });
    }
    if (!isAdmin) return jsonResponse({ error: "当前账号没有管理权限。" }, 403);

    if (body.action === "details") {
      if (!body.targetUserId) return jsonResponse({ error: "缺少用户 ID。" }, 400);
      return jsonResponse(await getDetails(body.targetUserId, serviceRoleKey));
    }
    if (body.action === "set-ai-access") {
      if (!body.targetUserId && !body.targetEmail) return jsonResponse({ error: "缺少用户 ID 或邮箱。" }, 400);
      return jsonResponse(await setAiAccess(body.targetUserId, body.targetEmail, body.access, serviceRoleKey));
    }
    if (body.action === "get-ai-settings") {
      return jsonResponse(await getAiSettings(serviceRoleKey));
    }
    if (body.action === "set-ai-settings") {
      return jsonResponse(await setAiSettings(body.settings, serviceRoleKey));
    }
    return jsonResponse(await getSummary(serviceRoleKey));
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "管理后台请求失败。" }, 500);
  }
});

async function getUser(authorization: string): Promise<SupabaseUser> {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      authorization
    }
  });
  if (!response.ok) throw new Error("登录状态已过期，请重新登录。");
  return await response.json() as SupabaseUser;
}

function serviceHeaders(serviceRoleKey: string, extra?: HeadersInit): HeadersInit {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

async function authAdminGet<T>(path: string, serviceRoleKey: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    headers: serviceHeaders(serviceRoleKey)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`读取账号信息失败：HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new Error("读取账号信息失败，请稍后再试。");
  }
  return JSON.parse(text) as T;
}

async function restGet<T>(
  table: string,
  serviceRoleKey: string,
  params: Record<string, string>,
  limit = 1000
): Promise<T[]> {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    headers: serviceHeaders(serviceRoleKey)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`读取 ${table} 失败：HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new Error("读取数据失败，请稍后再试。");
  }
  return JSON.parse(text) as T[];
}

async function optionalRestGet<T>(
  table: string,
  serviceRoleKey: string,
  params: Record<string, string>,
  limit = 1000
): Promise<T[]> {
  try {
    return await restGet<T>(table, serviceRoleKey, params, limit);
  } catch (error) {
    console.error(`跳过 ${table} 可选数据读取：${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function getAiAccess(userId: string, serviceRoleKey: string): Promise<AiAccessRow | null> {
  const rows = await restGet<AiAccessRow>("ai_assistant_access", serviceRoleKey, {
    select: "user_id,enabled,role,expires_at,note,created_at,updated_at",
    user_id: `eq.${userId}`
  }, 1);
  return rows[0] ?? null;
}

function isActiveAdmin(row: AiAccessRow | null): boolean {
  if (!row?.enabled || row.role !== "admin") return false;
  return !row.expires_at || new Date(row.expires_at).getTime() > Date.now();
}

function emptyCounts(): UserCounts {
  return {
    semesters: 0,
    courses: 0,
    events: 0,
    habits: 0,
    anniversaries: 0,
    memos: 0,
    focusSessions: 0
  };
}

async function getSummary(serviceRoleKey: string) {
  const authData = await authAdminGet<{ users?: SupabaseUser[] }>("users?page=1&per_page=1000", serviceRoleKey);
  const users = authData.users ?? [];
  const counts = new Map<string, UserCounts>();

  for (const config of SUMMARY_TABLES) {
    const records = await optionalRestGet<{ user_id: string; event_type?: string }>(config.table, serviceRoleKey, {
      select: config.table === "events" ? "user_id,event_type" : "user_id",
      deleted_at: "is.null"
    });
    for (const record of records) {
      const userCounts = counts.get(record.user_id) ?? emptyCounts();
      if (config.table === "events" && record.event_type === "habit") userCounts.habits += 1;
      else if (config.table === "events") userCounts.events += 1;
      else userCounts[config.key] += 1;
      counts.set(record.user_id, userCounts);
    }
  }

  const accessRows = await optionalRestGet<AiAccessRow>("ai_assistant_access", serviceRoleKey, {
    select: "user_id,enabled,role,expires_at,note,created_at,updated_at"
  });
  const accessByUser = new Map(accessRows.map((row) => [row.user_id, row]));
  const usageRows = await optionalRestGet<AiUsageRow>("ai_assistant_usage", serviceRoleKey, {
    select: "user_id,requested_at,status,prompt_tokens,completion_tokens,total_tokens,estimated_cost_cny"
  });
  const usageByUser = aggregateAiUsage(usageRows);

  return {
    passwordVisible: false,
    users: users.map((item) => ({
      id: item.id,
      email: item.email ?? "",
      createdAt: item.created_at ?? null,
      lastSignInAt: item.last_sign_in_at ?? null,
      confirmedAt: item.confirmed_at ?? null,
      counts: counts.get(item.id) ?? emptyCounts(),
      aiAccess: accessByUser.get(item.id) ?? null,
      aiUsage: usageByUser.get(item.id) ?? emptyAiUsage()
    })).sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
  };
}

async function getDetails(targetUserId: string, serviceRoleKey: string) {
  const authData = await authAdminGet<{ users?: SupabaseUser[] }>("users?page=1&per_page=1000", serviceRoleKey);
  const user = (authData.users ?? []).find((item) => item.id === targetUserId) ?? null;
  const [semesters, courses, events, anniversaries, memos, focusSessions, aiAccess, aiUsageRows] = await Promise.all([
    optionalRestGet( "semesters", serviceRoleKey, { select: DETAIL_TABLES.semesters, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    optionalRestGet("courses", serviceRoleKey, { select: DETAIL_TABLES.courses, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    optionalRestGet("events", serviceRoleKey, { select: DETAIL_TABLES.events, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    optionalRestGet("anniversaries", serviceRoleKey, { select: DETAIL_TABLES.anniversaries, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    optionalRestGet("memos", serviceRoleKey, { select: DETAIL_TABLES.memos, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    optionalRestGet("focus_sessions", serviceRoleKey, { select: DETAIL_TABLES.focus_sessions, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "started_at.desc" }),
    getAiAccess(targetUserId, serviceRoleKey).catch((error) => {
      console.error(`跳过用户权限读取：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }),
    optionalRestGet<AiUsageRow>("ai_assistant_usage", serviceRoleKey, {
      select: "user_id,requested_at,status,prompt_tokens,completion_tokens,total_tokens,estimated_cost_cny",
      user_id: `eq.${targetUserId}`
    })
  ]);

  return {
    passwordVisible: false,
    user: user ? {
      id: user.id,
      email: user.email ?? "",
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      confirmedAt: user.confirmed_at ?? null
    } : { id: targetUserId, email: "", createdAt: null, lastSignInAt: null, confirmedAt: null },
    aiAccess,
    aiUsage: aggregateAiUsage(aiUsageRows).get(targetUserId) ?? emptyAiUsage(),
    data: {
      semesters,
      courses,
      events,
      anniversaries,
      memos,
      focusSessions
    }
  };
}

function emptyAiUsage(): AiUsageSummary {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostCny: null,
    lastUsedAt: null,
    today: emptyAiUsagePeriod(),
    month: emptyAiUsagePeriod()
  };
}

function emptyAiUsagePeriod(): AiUsagePeriodSummary {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalTokens: 0,
    estimatedCostCny: null
  };
}

function aggregateAiUsage(rows: AiUsageRow[]): Map<string, AiUsageSummary> {
  const usageByUser = new Map<string, AiUsageSummary>();
  const todayStart = beijingPeriodStart("day");
  const monthStart = beijingPeriodStart("month");
  for (const row of rows) {
    const current = usageByUser.get(row.user_id) ?? emptyAiUsage();
    const requestedAt = new Date(row.requested_at).getTime();
    const cost = Number(row.estimated_cost_cny ?? NaN);
    current.requestCount += 1;
    if (row.status === "success") current.successCount += 1;
    if (row.status === "error") current.errorCount += 1;
    current.promptTokens += Number(row.prompt_tokens ?? 0);
    current.completionTokens += Number(row.completion_tokens ?? 0);
    current.totalTokens += Number(row.total_tokens ?? 0);
    if (Number.isFinite(cost)) current.estimatedCostCny = (current.estimatedCostCny ?? 0) + cost;
    if (!current.lastUsedAt || row.requested_at > current.lastUsedAt) current.lastUsedAt = row.requested_at;
    if (requestedAt >= todayStart) addUsageToPeriod(current.today, row, cost);
    if (requestedAt >= monthStart) addUsageToPeriod(current.month, row, cost);
    usageByUser.set(row.user_id, current);
  }
  return usageByUser;
}

function addUsageToPeriod(period: AiUsagePeriodSummary, row: AiUsageRow, cost: number) {
  period.requestCount += 1;
  if (row.status === "success") period.successCount += 1;
  if (row.status === "error") period.errorCount += 1;
  period.totalTokens += Number(row.total_tokens ?? 0);
  if (Number.isFinite(cost)) period.estimatedCostCny = (period.estimatedCostCny ?? 0) + cost;
}

function beijingPeriodStart(period: "day" | "month"): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = period === "month" ? "01" : parts.find((part) => part.type === "day")?.value ?? "01";
  return new Date(`${year}-${month}-${day}T00:00:00+08:00`).getTime();
}

async function resolveTargetUserId(targetUserId: string | undefined, targetEmail: string | undefined, serviceRoleKey: string): Promise<string> {
  const normalizedId = targetUserId?.trim();
  if (normalizedId) return normalizedId;
  const email = targetEmail?.trim().toLowerCase();
  if (!email) throw new Error("缺少用户 ID 或邮箱。");
  const authData = await authAdminGet<{ users?: SupabaseUser[] }>("users?page=1&per_page=1000", serviceRoleKey);
  const user = (authData.users ?? []).find((item) => item.email?.toLowerCase() === email);
  if (!user) throw new Error("没有找到该邮箱对应的账号。");
  return user.id;
}

async function setAiAccess(
  targetUserId: string | undefined,
  targetEmail: string | undefined,
  access: AdminRequest["access"],
  serviceRoleKey: string
) {
  const resolvedUserId = await resolveTargetUserId(targetUserId, targetEmail, serviceRoleKey);
  const role = access?.role === "admin" ? "admin" : "member";
  const body = {
    user_id: resolvedUserId,
    enabled: Boolean(access?.enabled),
    role,
    expires_at: access?.expiresAt || null,
    note: access?.note?.trim() || null,
    updated_at: new Date().toISOString()
  };
  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_access`);
  url.searchParams.set("on_conflict", "user_id");
  const response = await fetch(url, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`保存 AI 权限失败：HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new Error("保存 AI 助手权限失败，请稍后再试。");
  }
  const rows = JSON.parse(text) as AiAccessRow[];
  return { aiAccess: rows[0] ?? null };
}

async function getAiSettings(serviceRoleKey: string) {
  const rows = await restGet<Record<string, unknown>>("ai_assistant_settings", serviceRoleKey, {
    select: "enabled_for_all,ordinary_daily_limit,ordinary_weekly_limit,member_daily_limit,member_weekly_limit,provider,model,mimo_channel,updated_at",
    id: "eq.true"
  }, 1);
  return rows[0] ?? {
    enabled_for_all: false,
    ordinary_daily_limit: 20,
    ordinary_weekly_limit: 100,
    member_daily_limit: 50,
    member_weekly_limit: 300,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    mimo_channel: "payg",
    updated_at: null
  };
}

async function setAiSettings(settings: AdminRequest["settings"], serviceRoleKey: string) {
  const ordinaryDailyLimit = Math.floor(Number(settings?.ordinaryDailyLimit));
  const ordinaryWeeklyLimit = Math.floor(Number(settings?.ordinaryWeeklyLimit));
  const memberDailyLimit = Math.floor(Number(settings?.memberDailyLimit));
  const memberWeeklyLimit = Math.floor(Number(settings?.memberWeeklyLimit));
  const provider = settings?.provider === "mimo" ? "mimo" : "deepseek";
  const model = settings?.model?.trim() ?? "";
  const mimoChannel = settings?.mimoChannel === "token_plan" ? "token_plan" : "payg";
  if (!(ADMIN_AI_MODELS[provider] as readonly string[]).includes(model)) throw new Error("请选择当前 AI 提供商支持的模型。");
  if (!Number.isFinite(ordinaryDailyLimit) || ordinaryDailyLimit < 1 || ordinaryDailyLimit > 100000) {
    throw new Error("普通用户每日额度必须在 1 到 100000 之间。");
  }
  if (!Number.isFinite(ordinaryWeeklyLimit) || ordinaryWeeklyLimit < ordinaryDailyLimit || ordinaryWeeklyLimit > 1000000) {
    throw new Error("普通用户每周额度不能低于每日额度，且不能超过 1000000。");
  }
  if (!Number.isFinite(memberDailyLimit) || memberDailyLimit < 1 || memberDailyLimit > 100000) {
    throw new Error("会员每日额度必须在 1 到 100000 之间。");
  }
  if (!Number.isFinite(memberWeeklyLimit) || memberWeeklyLimit < memberDailyLimit || memberWeeklyLimit > 1000000) {
    throw new Error("会员每周额度不能低于每日额度，且不能超过 1000000。");
  }
  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_settings`);
  url.searchParams.set("on_conflict", "id");
  const response = await fetch(url, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify({
      id: true,
      enabled_for_all: Boolean(settings?.enabledForAll),
      daily_limit: ordinaryDailyLimit,
      weekly_limit: ordinaryWeeklyLimit,
      ordinary_daily_limit: ordinaryDailyLimit,
      ordinary_weekly_limit: ordinaryWeeklyLimit,
      member_daily_limit: memberDailyLimit,
      member_weekly_limit: memberWeeklyLimit,
      provider,
      model,
      mimo_channel: mimoChannel,
      updated_at: new Date().toISOString()
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`保存 AI 全局设置失败：${text.slice(0, 200)}`);
  return (JSON.parse(text) as Record<string, unknown>[])[0] ?? null;
}
