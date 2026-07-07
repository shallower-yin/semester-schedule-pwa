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
  enabled: boolean;
  role: "member" | "admin";
  expires_at: string | null;
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
    if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "请先登录后再使用 DeepSeek 助手。" }, 401);
    const body = await request.json() as AiAssistantRequest;
    const question = body.question?.trim();
    if (!question) return jsonResponse({ error: "问题不能为空。" }, 400);

    const user = await getUser(authorization);
    const access = await checkAiAccess(user, authorization, body.accessCode?.trim());
    if (!access.allowed) return jsonResponse({
      error: access.reason,
      code: "AI_ACCESS_REQUIRED"
    }, 403);

    const answer = await askDeepSeek(question, body.scheduleContext, user.email);
    return jsonResponse({
      answer,
      access: access.method
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
): Promise<{ allowed: boolean; method?: string; reason?: string }> {
  const configuredCode = optionalSecret("AI_ASSISTANT_ACCESS_CODE");
  if (configuredCode && accessCode && accessCode === configuredCode) {
    return { allowed: true, method: "access-code" };
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
  if (!response.ok) throw new Error(`读取 AI 权限失败：HTTP ${response.status}`);
  const rows = await response.json() as AiAccessRow[];
  const row = rows[0];
  if (!row?.enabled) return { allowed: false, reason: "当前账号未开通 DeepSeek 助手。" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { allowed: false, reason: "当前账号的 DeepSeek 助手权限已到期。" };
  }
  return { allowed: true, method: row.role };
}

async function askDeepSeek(question: string, scheduleContext: unknown, email?: string): Promise<string> {
  const apiKey = requiredSecret("DEEPSEEK_API_KEY");
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
            "不要输出用户隐私无关内容，也不要声称自己能访问未提供的数据。"
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
  if (!response.ok) throw new Error(`DeepSeek 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("DeepSeek 未返回有效回答。");
  return answer;
}
