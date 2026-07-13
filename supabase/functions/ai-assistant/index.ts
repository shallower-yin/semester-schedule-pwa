interface AiAssistantRequest {
  question?: string;
  scheduleContext?: unknown;
  accessCode?: string;
  history?: AiAssistantHistoryMessage[];
}

interface SupabaseUser {
  id: string;
  email?: string;
}

interface AiAccessRow {
  user_id?: string;
  enabled: boolean;
  role: "member" | "admin";
  expires_at: string | null;
  note?: string | null;
}

type AnniversaryKind = "anniversary" | "birthday" | "holiday";
type EventRecurrenceType = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "interval";
type AiAssistantAction = AiCreateEventAction | AiCreateAnniversaryAction | AiCreateMemoAction;

interface AiCreateEventAction {
  type: "create_event";
  eventType?: "event" | "habit";
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
  note?: string | null;
  recurrenceType?: EventRecurrenceType;
  recurrenceUntil?: string | null;
  recurrenceInterval?: number;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

interface AiCreateAnniversaryAction {
  type: "create_anniversary";
  title: string;
  kind?: AnniversaryKind;
  date?: string | null;
  note?: string | null;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  reminderTime?: string | null;
}

interface AiCreateMemoAction {
  type: "create_memo";
  title: string;
  content?: string | null;
  isPinned?: boolean;
}

interface AiAssistantResponse {
  answer: string;
  actions: AiAssistantAction[];
  model: string;
  usage: AiAssistantUsage;
}

interface ParsedAssistantResponse {
  answer: string;
  actions: AiAssistantAction[];
}

interface AiAssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiAssistantUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_cny: number | null;
}

type AiAccessMethod = "access-code" | "ordinary" | "member" | "admin";

interface AiQuotaSnapshot {
  requests: number;
  totalTokens: number;
  estimatedCostCny: number;
}

interface AiQuotaLimits {
  daily: number;
  weekly: number;
}

interface AiSettingsRow {
  enabled_for_all: boolean;
  ordinary_daily_limit: number;
  ordinary_weekly_limit: number;
  member_daily_limit: number;
  member_weekly_limit: number;
}

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

  const startedAt = Date.now();
  let currentUser: SupabaseUser | null = null;
  let accessMethod = "";
  let questionChars = 0;
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "请先登录后再使用 AI 助手。" }, 401);
    const body = await request.json() as AiAssistantRequest;
    const question = body.question?.trim();
    if (!question) return jsonResponse({ error: "问题不能为空。" }, 400);
    questionChars = question.length;

    const user = await getUser(authorization);
    currentUser = user;
    const serviceRoleKey = serviceRoleSecret();
    const settings = serviceRoleKey ? await getAiSettings(serviceRoleKey) : null;
    const access = await checkAiAccess(user, authorization, body.accessCode?.trim(), settings);
    if (!access.allowed) return jsonResponse({
      error: access.reason,
      code: "AI_ACCESS_REQUIRED"
    }, 403);
    accessMethod = access.method ?? "";

    const quota = await checkAiQuota(user.id, accessMethod, serviceRoleKey, settings);
    if (!quota.allowed) {
      await logAiAssistantUsage({
        userId: user.id,
        status: "error",
        accessMethod,
        model: optionalSecret("DEEPSEEK_MODEL") || "deepseek-v4-flash",
        usage: emptyUsage(),
        latencyMs: Date.now() - startedAt,
        questionChars,
        error: quota.reason
      });
      return jsonResponse({
        error: quota.reason,
        code: "AI_QUOTA_EXCEEDED"
      }, 429);
    }

    const history = sanitizeHistory(body.history);
    const assistantResponse = await askDeepSeek(question, body.scheduleContext, history, user.email);
    await logAiAssistantUsage({
      userId: user.id,
      status: "success",
      accessMethod,
      model: assistantResponse.model,
      usage: assistantResponse.usage,
      latencyMs: Date.now() - startedAt,
      questionChars
    });
    return jsonResponse({
      answer: assistantResponse.answer,
      actions: assistantResponse.actions,
      access: access.method,
      accessBound: false
    });
  } catch (error) {
    console.error(error);
    if (currentUser) {
      await logAiAssistantUsage({
        userId: currentUser.id,
        status: "error",
        accessMethod,
        model: optionalSecret("DEEPSEEK_MODEL") || "deepseek-v4-flash",
        usage: emptyUsage(),
        latencyMs: Date.now() - startedAt,
        questionChars,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "AI 助手请求失败。" }, 500);
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

async function checkAiAccess(
  user: SupabaseUser,
  authorization: string,
  accessCode: string | undefined,
  settings: AiSettingsRow | null
): Promise<{ allowed: boolean; method?: AiAccessMethod; reason?: string; bound?: boolean }> {
  const serviceRoleKey = serviceRoleSecret();
  const row = serviceRoleKey
    ? await getAiAccessByServiceRole(user.id, serviceRoleKey)
    : await getAiAccessByUserRpc(authorization);
  const rowActive = row?.enabled && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
  if (rowActive && row.role === "admin") {
    return { allowed: true, method: row.role };
  }
  if (rowActive) return { allowed: true, method: "member" };
  if (settings?.enabled_for_all) return { allowed: true, method: "ordinary" };

  const configuredCode = optionalSecret("AI_ASSISTANT_ACCESS_CODE");
  if (configuredCode && accessCode && accessCode === configuredCode) {
    return { allowed: true, method: "access-code", bound: false };
  }

  if (row?.enabled && row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { allowed: false, reason: "当前账号的 AI 助手权限已到期。" };
  }
  return { allowed: false, reason: "当前账号未开通 AI 助手。" };
}

async function checkAiQuota(
  userId: string,
  method: string,
  serviceRoleKey: string,
  settings: AiSettingsRow | null
): Promise<{ allowed: boolean; reason?: string; today?: AiQuotaSnapshot; week?: AiQuotaSnapshot }> {
  const accessMethod = method === "admin" || method === "member" || method === "ordinary" || method === "access-code" ? method : "access-code";
  const limits = quotaLimitsFor(accessMethod, settings);
  if (limits.daily === Number.POSITIVE_INFINITY && limits.weekly === Number.POSITIVE_INFINITY) {
    return { allowed: true };
  }
  if (!serviceRoleKey) {
    console.warn("AI quota check skipped: service role key is not configured.");
    return { allowed: true };
  }

  const weekStart = beijingPeriodStart("week");
  const todayStart = beijingPeriodStart("day");
  const [todayRequests, weekRequests] = await Promise.all([
    getSuccessfulAiUsageCount(userId, todayStart.iso, serviceRoleKey),
    getSuccessfulAiUsageCount(userId, weekStart.iso, serviceRoleKey)
  ]);
  const today = quotaSnapshot(todayRequests);
  const week = quotaSnapshot(weekRequests);

  if (today.requests >= limits.daily) {
    return {
      allowed: false,
      today,
      week,
      reason: `AI 助手今日可用次数已用完（${today.requests}/${limits.daily}），明天可继续使用。`
    };
  }
  if (week.requests >= limits.weekly) {
    return {
      allowed: false,
      today,
      week,
      reason: `AI 助手本周可用次数已用完（${week.requests}/${limits.weekly}），下周可继续使用。`
    };
  }
  return { allowed: true, today, week };
}

function quotaLimitsFor(method: AiAccessMethod, settings: AiSettingsRow | null): AiQuotaLimits {
  if (method === "admin") {
    return {
      daily: Number.POSITIVE_INFINITY,
      weekly: Number.POSITIVE_INFINITY
    };
  }
  if (method === "member") {
    return {
      daily: settings?.member_daily_limit ?? readQuotaLimit("AI_ASSISTANT_MEMBER_DAILY_LIMIT", 50),
      weekly: settings?.member_weekly_limit ?? readQuotaLimit("AI_ASSISTANT_MEMBER_WEEKLY_LIMIT", 300)
    };
  }
  if (method === "ordinary") {
    return {
      daily: settings?.ordinary_daily_limit ?? 20,
      weekly: settings?.ordinary_weekly_limit ?? 100
    };
  }
  return {
    daily: readQuotaLimit("AI_ASSISTANT_ACCESS_CODE_DAILY_LIMIT", 3),
    weekly: readQuotaLimit("AI_ASSISTANT_ACCESS_CODE_WEEKLY_LIMIT", 20)
  };
}

function readQuotaLimit(name: string, fallback: number): number {
  const raw = optionalSecret(name);
  if (!raw) return fallback;
  if (/^(0|off|false|unlimited)$/i.test(raw)) return Number.POSITIVE_INFINITY;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function beijingPeriodStart(period: "day" | "week"): { iso: string; time: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const date = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
  if (period === "week") {
    const noon = new Date(`${year}-${month}-${day}T12:00:00+08:00`);
    const isoWeekday = noon.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - (isoWeekday - 1));
  }
  return { iso: date.toISOString(), time: date.getTime() };
}

async function getAiSettings(serviceRoleKey: string): Promise<AiSettingsRow | null> {
  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_settings`);
  url.searchParams.set("select", "enabled_for_all,ordinary_daily_limit,ordinary_weekly_limit,member_daily_limit,member_weekly_limit");
  url.searchParams.set("id", "eq.true");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` }
  });
  if (!response.ok) {
    console.warn(`AI settings query failed: HTTP ${response.status}`);
    return null;
  }
  const rows = await response.json() as AiSettingsRow[];
  return rows[0] ?? null;
}

async function getSuccessfulAiUsageCount(userId: string, sinceIso: string, serviceRoleKey: string): Promise<number> {
  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_usage`);
  url.searchParams.set("select", "id");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("requested_at", `gte.${sinceIso}`);
  url.searchParams.set("status", "eq.success");
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      prefer: "count=exact",
      range: "0-0"
    }
  });
  if (!response.ok) {
    const text = await response.text();
    console.warn(`AI quota query failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    return 0;
  }
  const total = response.headers.get("content-range")?.split("/").pop();
  return total && total !== "*" ? Math.max(0, Number(total) || 0) : 0;
}

function quotaSnapshot(requests: number): AiQuotaSnapshot {
  return { requests, totalTokens: 0, estimatedCostCny: 0 };
}

async function getAiAccessByUserRpc(authorization: string): Promise<AiAccessRow | null> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_ai_access`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      authorization,
      "content-type": "application/json"
    },
    body: "{}"
  });
  if (!response.ok) throw new Error("读取 AI 助手权限失败，请稍后再试。");
  return await response.json() as AiAccessRow | null;
}

async function getAiAccessByServiceRole(userId: string, serviceRoleKey: string): Promise<AiAccessRow | null> {
  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_access`);
  url.searchParams.set("select", "user_id,enabled,role,expires_at,note");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`
    }
  });
  if (!response.ok) return null;
  const rows = await response.json() as AiAccessRow[];
  return rows[0] ?? null;
}

async function askDeepSeek(
  question: string,
  scheduleContext: unknown,
  history: AiAssistantHistoryMessage[],
  email?: string
): Promise<AiAssistantResponse> {
  const apiKey = optionalSecret("DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error("AI 助手暂时不可用，请稍后再试。");
  const model = optionalSecret("DEEPSEEK_MODEL") || "deepseek-v4-flash";
  const contextText = JSON.stringify(scheduleContext ?? {}, null, 2).slice(0, 18_000);
  const historyText = history.length
    ? history.map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`).join("\n").slice(0, 3_000)
    : "无";
  const beijingNow = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            "你是日程计划表的 AI 助手。",
            `当前北京时间：${beijingNow}。所有“今天、明天、今年、下周”等相对时间都必须按北京时间理解。`,
            "你可以回答两类问题：1）根据用户提供的数据回答安排、冲突、未完成、专注统计、纪念日和备忘录；2）回答本工具怎么使用。",
            "工具能力：普通事项支持日期、时间、全天、完成、重复、地点和提醒；习惯可打卡和统计；纪念日/生日/节日支持提前几天和指定时间提醒；备忘录支持文件夹、置顶、编号和待办；学期是可选学生功能。",
            "回答使用方法时，要用普通用户能听懂的说法，不要提底层服务、数据库或模型名称。",
            "只根据用户提供的日程上下文回答，不要编造不存在的课程、事项、纪念日、备忘录或专注记录。",
            "最近对话只用于理解指代，不要把它当成新的日程数据。",
            "回答要简洁、具体、可执行。涉及日期时使用明确日期。无法确定时直接说明。",
            "不要输出用户隐私无关内容，也不要声称自己能访问未提供的数据。",
            "你必须只返回 JSON 对象，不要使用 Markdown，不要输出额外解释。",
            "JSON 格式：{\"answer\":\"给用户看的简短回答\",\"actions\":[]}。",
            "当用户明确要求新增、创建、记录、加入日程、提醒、安排待办、创建日子或写备忘录时，把可创建内容放入 actions。",
            "创建普通事项或习惯使用 create_event，格式：{\"type\":\"create_event\",\"eventType\":\"event|habit\",\"title\":\"事项标题\",\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\",\"startTime\":\"HH:mm 或 null\",\"endTime\":\"HH:mm 或 null\",\"allDay\":false,\"location\":\"地点，可空\",\"note\":\"备注\",\"recurrenceType\":\"none|daily|weekdays|weekly|monthly|interval\",\"recurrenceUntil\":\"YYYY-MM-DD 或 null\",\"recurrenceInterval\":1,\"reminderEnabled\":false,\"reminderMinutesBefore\":10}。",
            "创建纪念日、生日或节日使用 create_anniversary，格式：{\"type\":\"create_anniversary\",\"title\":\"标题\",\"kind\":\"anniversary|birthday|holiday\",\"date\":\"YYYY-MM-DD\",\"note\":\"备注\",\"reminderEnabled\":false,\"reminderDaysBefore\":0,\"reminderTime\":\"09:00\"}。",
            "创建备忘录使用 create_memo，格式：{\"type\":\"create_memo\",\"title\":\"标题\",\"content\":\"正文\",\"isPinned\":false}。",
            "如果用户说创建春节、端午节、中秋节、清明节、除夕、母亲节、父亲节等常见节日，应按北京时间所在年份或用户指定年份给出对应公历日期；如果没有把握，可以返回 create_anniversary 且 date 为 null，应用会用内置日历校准常见节日。",
            "如果用户创建习惯并指定每天、工作日、每周、每月或每隔几天，必须写入 recurrenceType；指定结束日期时写入 recurrenceUntil。没有指定重复时 recurrenceType 为 none。",
            "如果事项缺少日期，或用户只是询问安排，不要创建 action；请在 answer 里追问或直接回答。",
            "如果事项给了日期但没有时间，创建全天事项，startTime/endTime 为 null，allDay 为 true。",
            "如果事项给了开始时间但没给结束时间，endTime 等于 startTime。",
            "最多返回 5 个 actions。"
          ].join("\n")
        },
        {
          role: "user",
          content: `账号：${email ?? "unknown"}\n\n日程上下文 JSON：\n${contextText}\n\n最近对话：\n${historyText}\n\n用户问题：${question}`
        }
      ],
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 900,
      stream: false
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error("AI 助手暂时不可用，请稍后再试。");
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Partial<AiAssistantUsage>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI 助手没有返回有效回答。");
  return {
    ...parseAssistantResponse(content),
    model,
    usage: normalizeUsage(data.usage)
  };
}

function sanitizeHistory(history: unknown): AiAssistantHistoryMessage[] {
  if (!Array.isArray(history)) return [];
  const result: AiAssistantHistoryMessage[] = [];
  for (const item of history) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "user" || record.role === "assistant" ? record.role : null;
    const content = typeof record.content === "string" ? record.content.trim().slice(0, 500) : "";
    if (role && content) result.push({ role, content });
  }
  return result.slice(-6);
}

function parseAssistantResponse(content: string): ParsedAssistantResponse {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { answer?: unknown; actions?: unknown };
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : cleaned;
    const actions = Array.isArray(parsed.actions) ? parsed.actions.flatMap(sanitizeAction).slice(0, 5) : [];
    return { answer, actions };
  } catch {
    return { answer: content, actions: [] };
  }
}

function sanitizeAction(action: unknown): AiAssistantAction[] {
  if (!action || typeof action !== "object") return [];
  const record = action as Record<string, unknown>;
  if (record.type === "create_anniversary") return sanitizeAnniversaryAction(record);
  if (record.type === "create_memo") return sanitizeMemoAction(record);
  if (record.type !== "create_event") return [];
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const startDate = typeof record.startDate === "string" ? record.startDate.trim() : "";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const endDate = typeof record.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.endDate) ? record.endDate : startDate;
  const startTime = normalizeTime(record.startTime);
  const endTime = normalizeTime(record.endTime) ?? startTime;
  const allDay = typeof record.allDay === "boolean" ? record.allDay : !startTime;
  const recurrenceType = normalizeRecurrenceType(record.recurrenceType);
  const recurrenceUntil = recurrenceType === "none"
    ? null
    : isoDateValue(record.recurrenceUntil) ?? endDate;
  return [{
    type: "create_event",
    eventType: record.eventType === "habit" ? "habit" : "event",
    title,
    startDate,
    endDate,
    startTime: allDay ? null : startTime,
    endTime: allDay ? null : endTime,
    allDay,
    location: typeof record.location === "string" ? record.location.trim().slice(0, 200) : "",
    note: typeof record.note === "string" ? record.note.slice(0, 500) : "",
    recurrenceType,
    recurrenceUntil,
    recurrenceInterval: recurrenceType === "interval" ? clampNumber(record.recurrenceInterval, 1, 366, 1) : 1,
    reminderEnabled: Boolean(record.reminderEnabled),
    reminderMinutesBefore: clampNumber(record.reminderMinutesBefore, 0, 7 * 24 * 60, 10)
  }];
}

function sanitizeAnniversaryAction(record: Record<string, unknown>): AiAssistantAction[] {
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const date = typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date.trim()) ? record.date.trim() : null;
  if (!title) return [];
  return [{
    type: "create_anniversary",
    title,
    kind: normalizeAnniversaryKind(record.kind),
    date,
    note: typeof record.note === "string" ? record.note.slice(0, 500) : "",
    reminderEnabled: Boolean(record.reminderEnabled),
    reminderDaysBefore: clampNumber(record.reminderDaysBefore, 0, 365, 0),
    reminderTime: normalizeTime(record.reminderTime) ?? "09:00"
  }];
}

function sanitizeMemoAction(record: Record<string, unknown>): AiAssistantAction[] {
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) return [];
  return [{
    type: "create_memo",
    title,
    content: typeof record.content === "string" ? record.content.slice(0, 10_000) : "",
    isPinned: Boolean(record.isPinned)
  }];
}

function normalizeAnniversaryKind(value: unknown): AnniversaryKind {
  return value === "anniversary" || value === "birthday" || value === "holiday" ? value : "anniversary";
}

function normalizeRecurrenceType(value: unknown): EventRecurrenceType {
  return value === "daily"
    || value === "weekdays"
    || value === "weekly"
    || value === "monthly"
    || value === "interval"
    ? value
    : "none";
}

function isoDateValue(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeUsage(usage: Partial<AiAssistantUsage> | undefined): AiAssistantUsage {
  const promptTokens = Math.max(0, Math.round(Number(usage?.prompt_tokens ?? 0)));
  const completionTokens = Math.max(0, Math.round(Number(usage?.completion_tokens ?? 0)));
  const reportedTotal = Math.max(0, Math.round(Number(usage?.total_tokens ?? 0)));
  const totalTokens = reportedTotal || promptTokens + completionTokens;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated_cost_cny: estimateCostCny(promptTokens, completionTokens)
  };
}

function emptyUsage(): AiAssistantUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_cny: null
  };
}

function estimateCostCny(promptTokens: number, completionTokens: number): number {
  const inputPrice = 1;
  const outputPrice = 2;
  return Number((((promptTokens / 1_000_000) * inputPrice) + ((completionTokens / 1_000_000) * outputPrice)).toFixed(8));
}

async function logAiAssistantUsage(input: {
  userId: string;
  status: "success" | "error";
  accessMethod: string;
  model: string;
  usage: AiAssistantUsage;
  latencyMs: number;
  questionChars: number;
  error?: string;
}) {
  const serviceRoleKey = serviceRoleSecret();
  if (!serviceRoleKey) return;
  try {
    const payload = {
      user_id: input.userId,
      status: input.status,
      access_method: input.accessMethod,
      model: input.model,
      prompt_tokens: input.usage.prompt_tokens,
      completion_tokens: input.usage.completion_tokens,
      total_tokens: input.usage.total_tokens,
      estimated_cost_cny: input.usage.estimated_cost_cny,
      latency_ms: input.latencyMs,
      question_chars: input.questionChars,
      error: input.error ? input.error.slice(0, 500) : null
    };
    const response = await fetch(`${supabaseUrl}/rest/v1/ai_assistant_usage`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      if (text.includes("estimated_cost_cny")) {
        const legacyPayload: Record<string, unknown> = { ...payload };
        delete legacyPayload.estimated_cost_cny;
        const retry = await fetch(`${supabaseUrl}/rest/v1/ai_assistant_usage`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
            prefer: "return=minimal"
          },
          body: JSON.stringify(legacyPayload)
        });
        if (retry.ok) return;
        console.error(`记录 AI 用量失败：HTTP ${retry.status} ${(await retry.text()).slice(0, 300)}`);
        return;
      }
      console.error(`记录 AI 用量失败：HTTP ${response.status} ${text.slice(0, 300)}`);
    }
  } catch (error) {
    console.error(`记录 AI 用量失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
