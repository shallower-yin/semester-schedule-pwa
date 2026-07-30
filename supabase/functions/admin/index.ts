type AdminAction =
  | "whoami"
  | "summary"
  | "details"
  | "set-ai-access"
  | "get-ai-settings"
  | "set-ai-settings"
  | "list-ai-relays"
  | "save-ai-relay"
  | "delete-ai-relay"
  | "test-ai-relay"
  | "set-account-ban"
  | "delete-my-account";

type AiRelayProtocol = "openai_compatible" | "deepseek" | "mimo";
type AiRelayTestKind = "text" | "audio";

interface AdminRequest {
  action?: AdminAction;
  targetUserId?: string;
  targetEmail?: string;
  relayId?: string;
  relayTestKind?: AiRelayTestKind;
  banned?: boolean;
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
    provider?: "deepseek" | "mimo" | "siliconflow" | "tju";
    model?: string;
    mimoChannel?: "payg" | "token_plan";
    audioProvider?: "mimo" | "siliconflow";
    audioModel?: string;
    textRelayId?: string | null;
    audioRelayId?: string | null;
    featureQuotas?: Record<string, {
      enabled_for_all?: boolean;
      ordinary_daily_limit?: number;
      ordinary_weekly_limit?: number;
      member_daily_limit?: number;
      member_weekly_limit?: number;
    }>;
  };
  relay?: {
    id?: string;
    name?: string;
    protocol?: AiRelayProtocol;
    baseUrl?: string;
    apiKey?: string;
    supportsText?: boolean;
    textModel?: string;
    supportsAudio?: boolean;
    audioModel?: string;
  };
}

interface AiRelayRow {
  id: string;
  name: string;
  protocol: AiRelayProtocol;
  base_url: string;
  supports_text: boolean;
  text_model: string | null;
  supports_audio: boolean;
  audio_model: string | null;
  last_tested_at: string | null;
  last_test_status: "success" | "error" | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface AiRelayRuntime extends AiRelayRow {
  api_key: string;
}

const ADMIN_AI_MODELS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  mimo: ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.5-pro-ultraspeed"],
  siliconflow: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"],
  tju: ["tju-llm"]
} as const;

const ADMIN_AUDIO_MODELS = {
  mimo: ["mimo-v2.5-asr"],
  siliconflow: ["TeleAI/TeleSpeechASR", "FunAudioLLM/SenseVoiceSmall"]
} as const;

function normalizeAdminAiProvider(value: unknown): keyof typeof ADMIN_AI_MODELS {
  return value === "mimo" || value === "siliconflow" || value === "tju" ? value : "deepseek";
}

interface SupabaseUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
  banned_until?: string | null;
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
    if (body.action === "delete-my-account") {
      await deleteOwnAccount(user, serviceRoleKey);
      return jsonResponse({ deleted: true });
    }
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
    if (body.action === "set-account-ban") {
      if (!body.targetUserId) return jsonResponse({ error: "缺少用户 ID。" }, 400);
      if (body.targetUserId === user.id) return jsonResponse({ error: "不能封禁当前登录的管理员账号。" }, 400);
      return jsonResponse(await setAccountBan(body.targetUserId, Boolean(body.banned), serviceRoleKey));
    }
    if (body.action === "get-ai-settings") {
      return jsonResponse(await getAiSettings(serviceRoleKey));
    }
    if (body.action === "set-ai-settings") {
      return jsonResponse(await setAiSettings(body.settings, serviceRoleKey));
    }
    if (body.action === "list-ai-relays") {
      return jsonResponse({ relays: await listAiRelays(serviceRoleKey) });
    }
    if (body.action === "save-ai-relay") {
      return jsonResponse({ relay: await saveAiRelay(body.relay, serviceRoleKey) });
    }
    if (body.action === "delete-ai-relay") {
      if (!body.relayId) return jsonResponse({ error: "缺少中转站 ID。" }, 400);
      await deleteAiRelay(body.relayId, serviceRoleKey);
      return jsonResponse({ deleted: true });
    }
    if (body.action === "test-ai-relay") {
      if (!body.relayId) return jsonResponse({ error: "缺少中转站 ID。" }, 400);
      const kind: AiRelayTestKind = body.relayTestKind === "audio" ? "audio" : "text";
      return jsonResponse(await testAiRelay(body.relayId, kind, serviceRoleKey));
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

async function authAdminUpdate<T>(path: string, body: Record<string, unknown>, serviceRoleKey: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    method: "PUT",
    headers: serviceHeaders(serviceRoleKey, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`修改账号状态失败：HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new Error("修改账号状态失败，请稍后再试。");
  }
  return JSON.parse(text) as T;
}

async function deleteOwnAccount(user: SupabaseUser, serviceRoleKey: string): Promise<void> {
  for (const bucket of ["account-avatars", "memo-images", "feedback-attachments"]) {
    await deleteStoragePrefix(bucket, user.id, serviceRoleKey);
  }
  const response = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}?should_soft_delete=false`,
    {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    }
  );
  if (!response.ok) {
    console.error(`注销账号失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    throw new Error("注销账号失败，请稍后重试。");
  }
}

async function deleteStoragePrefix(bucket: string, rootPrefix: string, serviceRoleKey: string): Promise<void> {
  const pending = [rootPrefix.replace(/^\/+|\/+$/g, "")];
  const objects: string[] = [];
  while (pending.length) {
    const prefix = pending.shift()!;
    let offset = 0;
    for (;;) {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: "POST",
        headers: serviceHeaders(serviceRoleKey, { "content-type": "application/json" }),
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } })
      });
      if (response.status === 404) break;
      if (!response.ok) {
        console.error(`列出 ${bucket}/${prefix} 失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
        throw new Error("清理账号附件失败，请稍后重试。");
      }
      const rows = await response.json() as Array<{ id?: string | null; name?: string; metadata?: unknown }>;
      for (const row of rows) {
        if (!row.name) continue;
        const path = `${prefix}/${row.name}`.replace(/^\/+/, "");
        if (row.id || row.metadata) objects.push(path);
        else pending.push(path);
      }
      if (rows.length < 1000) break;
      offset += rows.length;
    }
  }

  for (let index = 0; index < objects.length; index += 100) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey, { "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: objects.slice(index, index + 100) })
    });
    if (!response.ok) {
      console.error(`删除 ${bucket} 账号附件失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
      throw new Error("清理账号附件失败，请稍后重试。");
    }
  }
}

async function setAccountBan(targetUserId: string, banned: boolean, serviceRoleKey: string) {
  const user = await authAdminUpdate<SupabaseUser>(
    `users/${encodeURIComponent(targetUserId)}`,
    { ban_duration: banned ? "876000h" : "none" },
    serviceRoleKey
  );
  return {
    id: user.id,
    email: user.email ?? "",
    bannedUntil: user.banned_until ?? null
  };
}

async function restGet<T>(
  table: string,
  serviceRoleKey: string,
  params: Record<string, string>,
  limit?: number
): Promise<T[]> {
  const rows: T[] = [];
  const maximum = limit ?? Number.POSITIVE_INFINITY;
  while (rows.length < maximum) {
    const pageSize = Math.min(1000, maximum - rows.length);
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(rows.length));
    const response = await fetch(url, {
      headers: serviceHeaders(serviceRoleKey)
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`读取 ${table} 失败：HTTP ${response.status} ${text.slice(0, 300)}`);
      throw new Error("读取数据失败，请稍后再试。");
    }
    const page = JSON.parse(text) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function optionalRestGet<T>(
  table: string,
  serviceRoleKey: string,
  params: Record<string, string>,
  limit?: number
): Promise<T[]> {
  try {
    return await restGet<T>(table, serviceRoleKey, params, limit);
  } catch (error) {
    console.error(`跳过 ${table} 可选数据读取：${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function serviceRpc<T>(
  functionName: string,
  body: Record<string, unknown>,
  serviceRoleKey: string
): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`RPC ${functionName} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new Error("保存中转站失败，请检查配置后重试。");
  }
  return (text ? JSON.parse(text) : null) as T;
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
  const users = (await listAllAuthUsers(serviceRoleKey)).filter((user) => !isSmokeTestUser(user));
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

function isSmokeTestUser(user: SupabaseUser): boolean {
  return user.email?.toLowerCase() === "codex-ai-smoke@example.com"
    || user.user_metadata?.source === "codex-ai-access-smoke";
}

async function getDetails(targetUserId: string, serviceRoleKey: string) {
  const user = await authAdminGet<SupabaseUser>(`users/${encodeURIComponent(targetUserId)}`, serviceRoleKey).catch(() => null);
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
  const user = (await listAllAuthUsers(serviceRoleKey)).find((item) => item.email?.toLowerCase() === email);
  if (!user) throw new Error("没有找到该邮箱对应的账号。");
  return user.id;
}

async function listAllAuthUsers(serviceRoleKey: string): Promise<SupabaseUser[]> {
  const users: SupabaseUser[] = [];
  for (let page = 1; ; page += 1) {
    const result = await authAdminGet<{ users?: SupabaseUser[] }>(
      `users?page=${page}&per_page=1000`,
      serviceRoleKey
    );
    const batch = result.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
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
    select: "enabled_for_all,ordinary_daily_limit,ordinary_weekly_limit,member_daily_limit,member_weekly_limit,provider,model,mimo_channel,audio_provider,audio_model,text_relay_id,audio_relay_id,feature_quotas,updated_at",
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
    audio_provider: "mimo",
    audio_model: "mimo-v2.5-asr",
    text_relay_id: null,
    audio_relay_id: null,
    updated_at: null
  };
}

async function setAiSettings(settings: AdminRequest["settings"], serviceRoleKey: string) {
  const legacyQuota = {
    enabled_for_all: Boolean(settings?.enabledForAll),
    ordinary_daily_limit: Math.floor(Number(settings?.ordinaryDailyLimit)),
    ordinary_weekly_limit: Math.floor(Number(settings?.ordinaryWeeklyLimit)),
    member_daily_limit: Math.floor(Number(settings?.memberDailyLimit)),
    member_weekly_limit: Math.floor(Number(settings?.memberWeeklyLimit))
  };
  const featureQuotas = {
    assistant: normalizeAdminFeatureQuota(settings?.featureQuotas?.assistant, legacyQuota),
    translation: normalizeAdminFeatureQuota(settings?.featureQuotas?.translation, {
      enabled_for_all: true,
      ordinary_daily_limit: 50,
      ordinary_weekly_limit: 300,
      member_daily_limit: 150,
      member_weekly_limit: 900
    }),
    mind_map: normalizeAdminFeatureQuota(settings?.featureQuotas?.mind_map, legacyQuota),
    audio_transcription: normalizeAdminFeatureQuota(settings?.featureQuotas?.audio_transcription, {
      enabled_for_all: false,
      ordinary_daily_limit: 0,
      ordinary_weekly_limit: 0,
      member_daily_limit: 5,
      member_weekly_limit: 20
    })
  };
  const ordinaryDailyLimit = featureQuotas.assistant.ordinary_daily_limit;
  const ordinaryWeeklyLimit = featureQuotas.assistant.ordinary_weekly_limit;
  const memberDailyLimit = featureQuotas.assistant.member_daily_limit;
  const memberWeeklyLimit = featureQuotas.assistant.member_weekly_limit;
  const provider = normalizeAdminAiProvider(settings?.provider);
  const model = settings?.model?.trim() ?? "";
  const mimoChannel = settings?.mimoChannel === "token_plan" ? "token_plan" : "payg";
  const audioProvider = settings?.audioProvider === "siliconflow" ? "siliconflow" : "mimo";
  const audioModel = settings?.audioModel?.trim() ?? "";
  const textRelayId = normalizedUuidOrNull(settings?.textRelayId);
  const audioRelayId = normalizedUuidOrNull(settings?.audioRelayId);
  if (!(ADMIN_AI_MODELS[provider] as readonly string[]).includes(model)) throw new Error("请选择当前 AI 提供商支持的模型。");
  if (!(ADMIN_AUDIO_MODELS[audioProvider] as readonly string[]).includes(audioModel)) throw new Error("请选择当前音频转写通道支持的模型。");
  if (textRelayId) await requireRelayCapability(textRelayId, "text", serviceRoleKey);
  if (audioRelayId) await requireRelayCapability(audioRelayId, "audio", serviceRoleKey);
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
      enabled_for_all: featureQuotas.assistant.enabled_for_all,
      daily_limit: ordinaryDailyLimit,
      weekly_limit: ordinaryWeeklyLimit,
      ordinary_daily_limit: ordinaryDailyLimit,
      ordinary_weekly_limit: ordinaryWeeklyLimit,
      member_daily_limit: memberDailyLimit,
      member_weekly_limit: memberWeeklyLimit,
      provider,
      model,
      mimo_channel: mimoChannel,
      audio_provider: audioProvider,
      audio_model: audioModel,
      text_relay_id: textRelayId,
      audio_relay_id: audioRelayId,
      feature_quotas: featureQuotas,
      updated_at: new Date().toISOString()
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`保存 AI 全局设置失败：${text.slice(0, 200)}`);
  return (JSON.parse(text) as Record<string, unknown>[])[0] ?? null;
}

function normalizedUuidOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const candidate = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)) {
    throw new Error("中转站 ID 无效，请刷新后台后重试。");
  }
  return candidate;
}

async function listAiRelays(serviceRoleKey: string): Promise<AiRelayRow[]> {
  return await restGet<AiRelayRow>("ai_provider_relays", serviceRoleKey, {
    select: "id,name,protocol,base_url,supports_text,text_model,supports_audio,audio_model,last_tested_at,last_test_status,last_test_message,last_test_latency_ms,created_at,updated_at",
    order: "created_at.asc"
  });
}

async function requireRelayCapability(
  relayId: string,
  capability: AiRelayTestKind,
  serviceRoleKey: string
): Promise<AiRelayRow> {
  const rows = await restGet<AiRelayRow>("ai_provider_relays", serviceRoleKey, {
    select: "id,name,protocol,base_url,supports_text,text_model,supports_audio,audio_model,last_tested_at,last_test_status,last_test_message,last_test_latency_ms,created_at,updated_at",
    id: `eq.${relayId}`
  }, 1);
  const relay = rows[0];
  if (!relay) throw new Error("所选中转站不存在，请刷新后台后重试。");
  if (capability === "text" && !relay.supports_text) throw new Error("所选中转站未启用文本 AI。");
  if (capability === "audio" && !relay.supports_audio) throw new Error("所选中转站未启用音频转写。");
  return relay;
}

async function saveAiRelay(relay: AdminRequest["relay"], serviceRoleKey: string): Promise<AiRelayRow> {
  const id = relay?.id ? normalizedUuidOrNull(relay.id) : null;
  const name = relay?.name?.trim() ?? "";
  const protocol: AiRelayProtocol = relay?.protocol === "deepseek" || relay?.protocol === "mimo"
    ? relay.protocol
    : "openai_compatible";
  const baseUrl = await validatePublicRelayBaseUrl(relay?.baseUrl);
  const supportsText = Boolean(relay?.supportsText);
  const supportsAudio = Boolean(relay?.supportsAudio);
  const textModel = supportsText ? relay?.textModel?.trim() ?? "" : "";
  const audioModel = supportsAudio ? relay?.audioModel?.trim() ?? "" : "";
  if (!name || name.length > 80) throw new Error("中转站名称需为 1–80 个字符。");
  if (!supportsText && !supportsAudio) throw new Error("请至少启用文本 AI 或音频转写。");
  if (supportsAudio && protocol === "deepseek") throw new Error("DeepSeek 协议不提供音频转写，请改用 OpenAI 兼容或 MiMo。");
  if (supportsText && (!textModel || textModel.length > 160)) throw new Error("请填写有效的文本模型 ID。");
  if (supportsAudio && (!audioModel || audioModel.length > 160)) throw new Error("请填写有效的音频模型 ID。");
  const result = await serviceRpc<Record<string, unknown>>("admin_upsert_ai_provider_relay", {
    p_id: id,
    p_name: name,
    p_protocol: protocol,
    p_base_url: baseUrl,
    p_api_key: relay?.apiKey?.trim() ?? "",
    p_supports_text: supportsText,
    p_text_model: textModel || null,
    p_supports_audio: supportsAudio,
    p_audio_model: audioModel || null
  }, serviceRoleKey);
  return normalizeRelayRpcResult(result);
}

function normalizeRelayRpcResult(value: Record<string, unknown>): AiRelayRow {
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    protocol: value.protocol === "deepseek" || value.protocol === "mimo" ? value.protocol : "openai_compatible",
    base_url: String(value.base_url ?? ""),
    supports_text: Boolean(value.supports_text),
    text_model: typeof value.text_model === "string" ? value.text_model : null,
    supports_audio: Boolean(value.supports_audio),
    audio_model: typeof value.audio_model === "string" ? value.audio_model : null,
    last_tested_at: typeof value.last_tested_at === "string" ? value.last_tested_at : null,
    last_test_status: value.last_test_status === "success" || value.last_test_status === "error" ? value.last_test_status : null,
    last_test_message: typeof value.last_test_message === "string" ? value.last_test_message : null,
    last_test_latency_ms: Number.isFinite(Number(value.last_test_latency_ms)) ? Number(value.last_test_latency_ms) : null,
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? "")
  };
}

async function deleteAiRelay(relayId: string, serviceRoleKey: string): Promise<void> {
  const id = normalizedUuidOrNull(relayId);
  if (!id) throw new Error("中转站 ID 无效。");
  await serviceRpc<null>("admin_delete_ai_provider_relay", { p_id: id }, serviceRoleKey);
}

async function getAiRelayRuntime(relayId: string, serviceRoleKey: string): Promise<AiRelayRuntime> {
  const value = await serviceRpc<Record<string, unknown> | null>(
    "get_ai_provider_relay_runtime",
    { p_id: relayId },
    serviceRoleKey
  );
  if (!value) throw new Error("中转站不存在或密钥不可用，请重新保存配置。");
  return {
    ...normalizeRelayRpcResult(value),
    api_key: typeof value.api_key === "string" ? value.api_key : ""
  };
}

async function testAiRelay(
  relayId: string,
  kind: AiRelayTestKind,
  serviceRoleKey: string
): Promise<{ ok: boolean; kind: AiRelayTestKind; status: number | null; latencyMs: number; message: string }> {
  const id = normalizedUuidOrNull(relayId);
  if (!id) throw new Error("中转站 ID 无效。");
  const relay = await getAiRelayRuntime(id, serviceRoleKey);
  if (kind === "text" && !relay.supports_text) throw new Error("该中转站未启用文本 AI。");
  if (kind === "audio" && !relay.supports_audio) throw new Error("该中转站未启用音频转写。");
  await validatePublicRelayBaseUrl(relay.base_url);
  const startedAt = Date.now();
  let status: number | null = null;
  let ok = false;
  let message = "";
  try {
    const response = kind === "audio"
      ? await testAudioRelay(relay)
      : await testTextRelay(relay);
    status = response.status;
    ok = response.ok;
    message = ok
      ? `${kind === "audio" ? "音频转写" : "文本 AI"}连通正常（HTTP ${response.status}）。`
      : `上游拒绝请求（HTTP ${response.status}）：${await safeRelayResponseMessage(response)}`;
  } catch (error) {
    message = relayFetchErrorMessage(error);
  }
  const latencyMs = Math.min(300000, Math.max(0, Date.now() - startedAt));
  await recordRelayTest(id, ok, message, latencyMs, serviceRoleKey).catch((error) => {
    console.error(`Recording relay test failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { ok, kind, status, latencyMs, message };
}

async function testTextRelay(relay: AiRelayRuntime): Promise<Response> {
  const endpoint = relayEndpoint(relay.base_url, "chat/completions");
  const headers: Record<string, string> = {
    authorization: `Bearer ${relay.api_key}`,
    "content-type": "application/json"
  };
  if (relay.protocol === "mimo") headers["api-key"] = relay.api_key;
  const body: Record<string, unknown> = {
    model: relay.text_model,
    messages: [{ role: "user", content: "Reply only with OK." }],
    stream: false,
    temperature: 0
  };
  if (relay.protocol === "mimo") body.max_completion_tokens = 8;
  else body.max_tokens = 8;
  return await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
}

async function testAudioRelay(relay: AiRelayRuntime): Promise<Response> {
  const wav = tinySilentWav();
  if (relay.protocol === "mimo") {
    return await fetch(relayEndpoint(relay.base_url, "chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${relay.api_key}`,
        "api-key": relay.api_key,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: relay.audio_model,
        messages: [{
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${bytesToBase64(wav)}` } }]
        }],
        asr_options: { language: "auto" },
        stream: false
      }),
      signal: AbortSignal.timeout(20_000)
    });
  }
  const form = new FormData();
  form.set("model", relay.audio_model ?? "");
  form.set("file", new Blob([Uint8Array.from(wav).buffer], { type: "audio/wav" }), "connectivity-test.wav");
  return await fetch(relayEndpoint(relay.base_url, "audio/transcriptions"), {
    method: "POST",
    headers: { authorization: `Bearer ${relay.api_key}` },
    body: form,
    signal: AbortSignal.timeout(20_000)
  });
}

async function recordRelayTest(
  relayId: string,
  ok: boolean,
  message: string,
  latencyMs: number,
  serviceRoleKey: string
): Promise<void> {
  const url = new URL(`${supabaseUrl}/rest/v1/ai_provider_relays`);
  url.searchParams.set("id", `eq.${relayId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: serviceHeaders(serviceRoleKey, {
      "content-type": "application/json",
      prefer: "return=minimal"
    }),
    body: JSON.stringify({
      last_tested_at: new Date().toISOString(),
      last_test_status: ok ? "success" : "error",
      last_test_message: message.slice(0, 300),
      last_test_latency_ms: latencyMs
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function relayEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function validatePublicRelayBaseUrl(value: unknown): Promise<string> {
  const input = String(value ?? "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("中转地址无效，请填写包含 https:// 的 API 基础地址。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("中转地址必须是无账号参数的公网 HTTPS 基础地址。");
  }
  if (url.pathname === "/") url.pathname = "";
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname === "metadata.google.internal" || isPrivateAddress(hostname)) {
    throw new Error("中转地址不能指向本机、内网或云元数据服务。");
  }
  const resolved = await Promise.all([
    Deno.resolveDns(hostname, "A").catch(() => [] as string[]),
    Deno.resolveDns(hostname, "AAAA").catch(() => [] as string[])
  ]);
  if (resolved.flat().some(isPrivateAddress)) {
    throw new Error("中转域名解析到了内网地址，已拒绝保存。");
  }
  return url.toString().replace(/\/+$/, "");
}

function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.includes(":")) {
    return address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd")
      || /^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("::ffff:127.")
      || address.startsWith("::ffff:10.") || address.startsWith("::ffff:192.168.")
      || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(address);
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

async function safeRelayResponseMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const error = payload.error && typeof payload.error === "object"
      ? (payload.error as { message?: unknown }).message
      : payload.error;
    const message = typeof error === "string" ? error : typeof payload.message === "string" ? payload.message : "";
    return sanitizeRelayMessage(message) || "请检查密钥、模型 ID 和接口协议。";
  } catch {
    return "请检查密钥、模型 ID 和接口协议。";
  }
}

function relayFetchErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "连接上游超时，请检查地址或稍后重试。";
  const text = error instanceof Error ? error.message : "";
  if (/certificate|tls|ssl/i.test(text)) return "上游 HTTPS 证书校验失败。";
  return "无法连接上游，请检查地址、网络和防火墙。";
}

function sanitizeRelayMessage(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[密钥已隐藏]").replace(/\s+/g, " ").trim().slice(0, 180);
}

function tinySilentWav(): Uint8Array {
  const sampleRate = 8_000;
  const samples = 800;
  const dataSize = samples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function normalizeAdminFeatureQuota(value: Record<string, unknown> | undefined, fallback: Record<string, unknown>) {
  const source = value ?? fallback;
  const ordinaryDaily = adminQuotaNumber(source.ordinary_daily_limit, 100000);
  const ordinaryWeekly = adminQuotaNumber(source.ordinary_weekly_limit, 1000000);
  const memberDaily = adminQuotaNumber(source.member_daily_limit, 100000);
  const memberWeekly = adminQuotaNumber(source.member_weekly_limit, 1000000);
  if (ordinaryWeekly < ordinaryDaily || memberWeekly < memberDaily) {
    throw new Error("每周额度不能低于每日额度。");
  }
  return {
    enabled_for_all: Boolean(source.enabled_for_all),
    ordinary_daily_limit: ordinaryDaily,
    ordinary_weekly_limit: ordinaryWeekly,
    member_daily_limit: memberDaily,
    member_weekly_limit: memberWeekly
  };
}

function adminQuotaNumber(value: unknown, max: number): number {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) {
    throw new Error(`AI 额度必须在 0 到 ${max} 之间。`);
  }
  return numeric;
}
