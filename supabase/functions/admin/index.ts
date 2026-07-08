type AdminAction = "whoami" | "summary" | "details" | "set-ai-access";

interface AdminRequest {
  action?: AdminAction;
  targetUserId?: string;
  access?: {
    enabled?: boolean;
    role?: "member" | "admin";
    expiresAt?: string | null;
    note?: string | null;
  };
}

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
  events: "id,event_type,title,start_date,start_time,end_date,end_time,all_day,color,note,recurrence_type,reminder_enabled,updated_at",
  anniversaries: "id,kind,title,date,color,note,reminder_enabled,reminder_days_before,reminder_time,updated_at",
  memos: "id,title,content,is_pinned,updated_at",
  focus_sessions: "id,mode,task_title,duration_seconds,started_at,ended_at,completed,interrupted"
} as const;

function optionalSecret(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
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

    const serviceRoleKey = optionalSecret("SUPABASE_SERVICE_ROLE_KEY");
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
      if (!body.targetUserId) return jsonResponse({ error: "缺少用户 ID。" }, 400);
      return jsonResponse(await setAiAccess(body.targetUserId, body.access, serviceRoleKey));
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
    const records = await restGet<{ user_id: string; event_type?: string }>(config.table, serviceRoleKey, {
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

  const accessRows = await restGet<AiAccessRow>("ai_assistant_access", serviceRoleKey, {
    select: "user_id,enabled,role,expires_at,note,created_at,updated_at"
  });
  const accessByUser = new Map(accessRows.map((row) => [row.user_id, row]));

  return {
    passwordVisible: false,
    users: users.map((item) => ({
      id: item.id,
      email: item.email ?? "",
      createdAt: item.created_at ?? null,
      lastSignInAt: item.last_sign_in_at ?? null,
      confirmedAt: item.confirmed_at ?? null,
      counts: counts.get(item.id) ?? emptyCounts(),
      aiAccess: accessByUser.get(item.id) ?? null
    })).sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
  };
}

async function getDetails(targetUserId: string, serviceRoleKey: string) {
  const authData = await authAdminGet<{ users?: SupabaseUser[] }>("users?page=1&per_page=1000", serviceRoleKey);
  const user = (authData.users ?? []).find((item) => item.id === targetUserId) ?? null;
  const [semesters, courses, events, anniversaries, memos, focusSessions, aiAccess] = await Promise.all([
    restGet( "semesters", serviceRoleKey, { select: DETAIL_TABLES.semesters, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    restGet("courses", serviceRoleKey, { select: DETAIL_TABLES.courses, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    restGet("events", serviceRoleKey, { select: DETAIL_TABLES.events, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    restGet("anniversaries", serviceRoleKey, { select: DETAIL_TABLES.anniversaries, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    restGet("memos", serviceRoleKey, { select: DETAIL_TABLES.memos, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "updated_at.desc" }),
    restGet("focus_sessions", serviceRoleKey, { select: DETAIL_TABLES.focus_sessions, user_id: `eq.${targetUserId}`, deleted_at: "is.null", order: "started_at.desc" }),
    getAiAccess(targetUserId, serviceRoleKey)
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

async function setAiAccess(targetUserId: string, access: AdminRequest["access"], serviceRoleKey: string) {
  const role = access?.role === "admin" ? "admin" : "member";
  const body = {
    user_id: targetUserId,
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
