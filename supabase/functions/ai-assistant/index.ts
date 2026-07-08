interface AiAssistantRequest {
  question?: string;
  scheduleContext?: unknown;
  accessCode?: string;
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

interface AiAssistantAction {
  type: "create_event";
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  note?: string | null;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

interface AiAssistantResponse {
  answer: string;
  actions: AiAssistantAction[];
}

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
    if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "请先登录后再使用 AI 助手。" }, 401);
    const body = await request.json() as AiAssistantRequest;
    const question = body.question?.trim();
    if (!question) return jsonResponse({ error: "问题不能为空。" }, 400);

    const user = await getUser(authorization);
    const access = await checkAiAccess(user, authorization, body.accessCode?.trim());
    if (!access.allowed) return jsonResponse({
      error: access.reason,
      code: "AI_ACCESS_REQUIRED"
    }, 403);

    const assistantResponse = await askDeepSeek(question, body.scheduleContext, user.email);
    return jsonResponse({
      answer: assistantResponse.answer,
      actions: assistantResponse.actions,
      access: access.method,
      accessBound: access.bound
    });
  } catch (error) {
    console.error(error);
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
  accessCode: string | undefined
): Promise<{ allowed: boolean; method?: string; reason?: string; bound?: boolean }> {
  const configuredCode = optionalSecret("AI_ASSISTANT_ACCESS_CODE");
  if (configuredCode && accessCode && accessCode === configuredCode) {
    const bound = await bindMemberAccess(user.id);
    return { allowed: true, method: bound ? "member" : "access-code", bound };
  }

  const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_access`);
  url.searchParams.set("select", "enabled,role,expires_at");
  url.searchParams.set("user_id", `eq.${user.id}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: publishableKey,
      authorization
    }
  });
  if (!response.ok) throw new Error("读取 AI 助手权限失败，请稍后再试。");
  const rows = await response.json() as AiAccessRow[];
  const row = rows[0];
  if (!row?.enabled) return { allowed: false, reason: "当前账号未开通 AI 助手。" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { allowed: false, reason: "当前账号的 AI 助手权限已到期。" };
  }
  return { allowed: true, method: row.role };
}

async function bindMemberAccess(userId: string): Promise<boolean> {
  const serviceRoleKey = optionalSecret("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return false;
  try {
    const existing = await getAiAccessByServiceRole(userId, serviceRoleKey);
    const body = {
      user_id: userId,
      enabled: true,
      role: existing?.role === "admin" ? "admin" : "member",
      expires_at: existing?.role === "admin" ? existing.expires_at : null,
      note: existing?.note || "访问口令开通",
      updated_at: new Date().toISOString()
    };
    const url = new URL(`${supabaseUrl}/rest/v1/ai_assistant_access`);
    url.searchParams.set("on_conflict", "user_id");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      console.error(`绑定 AI 助手权限失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
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

async function askDeepSeek(question: string, scheduleContext: unknown, email?: string): Promise<AiAssistantResponse> {
  const apiKey = optionalSecret("DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error("AI 助手暂时不可用，请稍后再试。");
  const model = optionalSecret("DEEPSEEK_MODEL") || "deepseek-v4-flash";
  const contextText = JSON.stringify(scheduleContext ?? {}, null, 2).slice(0, 18_000);
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
            "你是日程计划表的 AI 日程助手。",
            "只根据用户提供的日程上下文回答，不要编造不存在的课程、事项、纪念日或专注记录。",
            "回答要简洁、具体、可执行。涉及日期时使用明确日期。无法确定时直接说明。",
            "不要输出用户隐私无关内容，也不要声称自己能访问未提供的数据。",
            "你必须只返回 JSON 对象，不要使用 Markdown，不要输出额外解释。",
            "JSON 格式：{\"answer\":\"给用户看的简短回答\",\"actions\":[]}。",
            "当用户明确要求新增、创建、记录、加入日程、提醒或安排待办事项时，把可创建的事项放入 actions。",
            "actions 只允许 create_event，格式：{\"type\":\"create_event\",\"title\":\"事项标题\",\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\",\"startTime\":\"HH:mm 或 null\",\"endTime\":\"HH:mm 或 null\",\"allDay\":false,\"note\":\"备注\",\"reminderEnabled\":false,\"reminderMinutesBefore\":10}。",
            "如果缺少日期，或用户只是询问安排，不要创建 action；请在 answer 里追问或直接回答。",
            "如果用户给了日期但没有时间，创建全天事项，startTime/endTime 为 null，allDay 为 true。",
            "如果用户给了开始时间但没给结束时间，endTime 等于 startTime。",
            "最多返回 5 个 actions。"
          ].join("\n")
        },
        {
          role: "user",
          content: `账号：${email ?? "unknown"}\n\n日程上下文 JSON：\n${contextText}\n\n用户问题：${question}`
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
  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI 助手没有返回有效回答。");
  return parseAssistantResponse(content);
}

function parseAssistantResponse(content: string): AiAssistantResponse {
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
  if (record.type !== "create_event") return [];
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const startDate = typeof record.startDate === "string" ? record.startDate.trim() : "";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const endDate = typeof record.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.endDate) ? record.endDate : startDate;
  const startTime = normalizeTime(record.startTime);
  const endTime = normalizeTime(record.endTime) ?? startTime;
  const allDay = typeof record.allDay === "boolean" ? record.allDay : !startTime;
  return [{
    type: "create_event",
    title,
    startDate,
    endDate,
    startTime: allDay ? null : startTime,
    endTime: allDay ? null : endTime,
    allDay,
    note: typeof record.note === "string" ? record.note.slice(0, 500) : "",
    reminderEnabled: Boolean(record.reminderEnabled),
    reminderMinutesBefore: clampNumber(record.reminderMinutesBefore, 0, 7 * 24 * 60, 10)
  }];
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
