import { assert, assertEquals } from "jsr:@std/assert@1";
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3.1089.0";

type Handler = (request: Request) => Response | Promise<Response>;

Deno.test("installed clients use MiMo V2.6 through the Edge handler", async (t) => {
  const testEnvironment: Record<string, string> = {
    SUPABASE_URL: "https://backend.invalid",
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
      default: "test-publishable-key",
    }),
    SERVICE_ROLE_KEY: "test-service-role-key",
    MIMO_PAYG_API_KEY: "test-mimo-key",
    MIMO_PAYG_BASE_URL: "https://mimo-provider.invalid/v1",
    R2_ENDPOINT: "https://r2.invalid",
    R2_BUCKET: "test-images",
    R2_ACCESS_KEY_ID: "test-access",
    R2_SECRET_ACCESS_KEY: "test-secret",
  };
  const previousEnvironment = new Map(
    Object.keys(testEnvironment).map((name) => [name, Deno.env.get(name)]),
  );
  const originalServe = Deno.serve;
  const originalFetch = globalThis.fetch;
  const originalDns = Deno.resolveDns;
  let handler: Handler | undefined;

  try {
    Deno.resolveDns = (async (_host: string, type: string) => type === "A" ? ["93.184.216.34"] : []) as typeof Deno.resolveDns;
    for (const [name, value] of Object.entries(testEnvironment)) {
      Deno.env.set(name, value);
    }
    Deno.serve = ((callback: Handler) => {
      handler = callback;
      return {} as Deno.HttpServer;
    }) as typeof Deno.serve;
    await import("./index.ts");
    Deno.serve = originalServe;
    assert(
      handler,
      "The real Edge entrypoint must register its request handler",
    );
    const invoke = async (body: Record<string, unknown>) => {
      const response = await handler!(
        new Request("https://edge.invalid/ai-assistant", {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-token",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      const result = await response.json();
      assertEquals(response.status, 200, JSON.stringify(result));
      return result;
    };

    const cases = [
      { name: "legacy Flash", model: "mimo-v2.5", expected: "mimo-v2.6-flash" },
      { name: "legacy Pro", model: "mimo-v2.5-pro", expected: "mimo-v2.6-pro" },
      {
        name: "V2.6 Flash",
        model: "mimo-v2.6-flash",
        expected: "mimo-v2.6-flash",
      },
      { name: "V2.6 Pro", model: "mimo-v2.6-pro", expected: "mimo-v2.6-pro" },
      {
        name: "MiMo relay Flash",
        model: "mimo-v2.5",
        expected: "mimo-v2.6-flash",
        protocol: "mimo",
      },
      {
        name: "MiMo relay Pro",
        model: "mimo-v2.5-pro",
        expected: "mimo-v2.6-pro",
        protocol: "mimo",
      },
      {
        name: "third-party relay",
        model: "mimo-v2.5",
        expected: "mimo-v2.5",
        protocol: "openai_compatible",
      },
    ];

    for (const scenario of cases) {
      await t.step(scenario.name, async () => {
        const isMimo = scenario.protocol !== "openai_compatible";
        const providerCalls: Array<
          { body: Record<string, unknown>; headers: Headers }
        > = [];
        const reservedModels: unknown[] = [];
        const unexpectedCalls: string[] = [];
        const relay = scenario.protocol
          ? {
            name: "test relay",
            protocol: scenario.protocol,
            base_url: "https://relay.invalid/v1",
            api_key: "test-relay-key",
            supports_text: true,
            text_model: scenario.model,
            supports_audio: false,
          }
          : null;
        const settings = {
          provider: "mimo",
          model: scenario.model,
          mimo_channel: "payg",
          audio_provider: "mimo",
          audio_model: "mimo-v2.5-asr",
          text_relay: relay,
        };
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          const json = (value: unknown) => Response.json(value);
          if (url.origin === "https://backend.invalid") {
            if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") {
              return json(settings);
            }
            if (url.pathname === "/auth/v1/user") {
              return json({ id: "test-user-id" });
            }
            if (url.pathname === "/rest/v1/ai_assistant_access") {
              return json([{ enabled: true, role: "admin", expires_at: null }]);
            }
            if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") {
              return json({ allowed: true });
            }
            if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") {
              reservedModels.push((await request.json()).p_model);
              return json({ allowed: true, todayRequests: 1, weekRequests: 1 });
            }
            if (url.pathname === "/rest/v1/ai_assistant_usage") {
              return new Response(null, { status: 204 });
            }
          }
          const expectedUrl = scenario.protocol
            ? "https://relay.invalid/v1/chat/completions"
            : "https://mimo-provider.invalid/v1/chat/completions";
          if (request.url === expectedUrl) {
            providerCalls.push({
              body: await request.json(),
              headers: request.headers,
            });
            return json({
              choices: [{
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({ answer: "测试回答", actions: [] }),
                },
              }],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 10,
                total_tokens: 30,
              },
            });
          }
          unexpectedCalls.push(request.url);
          throw new Error(`Unexpected mocked request: ${request.url}`);
        };

        const configuration = await invoke({ action: "configuration" });
        assertEquals(configuration.supportsAttachments, isMimo);
        assertEquals(
          providerCalls.length,
          0,
          "Reading capabilities must not invoke a model",
        );
        assertEquals(
          reservedModels.length,
          0,
          "Reading capabilities must not reserve quota",
        );

        const imageUrl = "data:image/png;base64,aGVsbG8=";
        const result = await invoke({
          question: "你好",
          ...(isMimo
            ? {
              attachments: [{
                kind: "image",
                name: "test.png",
                dataUrl: imageUrl,
              }],
            }
            : {}),
        });
        assertEquals(result.answer, "测试回答");
        assertEquals(providerCalls.length, 1);
        assertEquals(reservedModels, [scenario.expected]);
        const { body, headers } = providerCalls[0];
        assertEquals(body.model, scenario.expected);
        if (isMimo) {
          assertEquals(body.max_completion_tokens, 16000);
          assertEquals(body.max_tokens, undefined);
          assertEquals(body.thinking, { type: "disabled" });
          assertEquals(body.response_format, { type: "json_object" });
          assertEquals(
            headers.get("api-key"),
            relay ? "test-relay-key" : "test-mimo-key",
          );
          const messages = body.messages as Array<
            { content: Array<{ type: string; image_url?: { url: string } }> }
          >;
          assertEquals(messages[1].content.find((part) => part.type === "image_url"), {
            type: "image_url",
            image_url: { url: imageUrl },
          });
        } else {
          assertEquals(body.max_tokens, 4096);
          assertEquals(body.max_completion_tokens, undefined);
        }
        // Exercise feature call sites as well as the shared request builder.
        for (const feature of [
          { request: { mode: "translation", question: "你好" }, temperature: 0.1, tokens: 6000, legacyTokens: false },
          { request: { mode: "mind_map_followup", question: "解释主题", mindMap: { label: "主题", children: [] } }, temperature: 0.45, tokens: 1800, legacyTokens: false },
          { request: { action: "summarize_audio_transcript", audioTranscript: "测试转写正文" }, temperature: 0.2, tokens: 1200, legacyTokens: true },
          { request: { mode: "audio_followup", question: "解释录音", audioTranscript: "测试转写正文" }, temperature: 0.2, tokens: 1400, legacyTokens: true }
        ]) {
          const previousCalls = providerCalls.length;
          await invoke(feature.request);
          assertEquals(providerCalls.length, previousCalls + 1);
          const call = providerCalls.at(-1)!;
          const completionTokens = isMimo && !feature.legacyTokens;
          assertEquals(call.body.model, scenario.expected);
          assertEquals(call.body.temperature, feature.temperature);
          assertEquals(call.body.max_completion_tokens, completionTokens ? feature.tokens : undefined);
          assertEquals(call.body.max_tokens, completionTokens ? undefined : feature.tokens);
          assertEquals(call.body.thinking, isMimo ? { type: "disabled" } : undefined);
          assertEquals(call.body.response_format, undefined);
          assertEquals(call.body.stream, false);
          assertEquals(call.headers.get("authorization"), `Bearer ${relay ? "test-relay-key" : "test-mimo-key"}`);
          assertEquals(call.headers.get("api-key"), isMimo ? relay ? "test-relay-key" : "test-mimo-key" : null);
        }
        assertEquals(unexpectedCalls, []);
      });
    }
    await t.step("attachment imports preserve every source row and expose real memo folder actions", async () => {
      let payload: Record<string, unknown> = {
        sourceRowCounts: [{ sourceIndex: 1, count: 1 }, { sourceIndex: 2, count: 1 }, { sourceIndex: 3, count: 1 }],
        rows: [
          { sourceIndex: 1, rowIndex: 1, startDate: "2026-11-22", endDate: "2026-11-28", title: "2022年论文学习", details: "公式(1)～(7)与图4", outcome: "解释机构位姿", startTime: null, endTime: null },
          { sourceIndex: 2, rowIndex: 1, startDate: "12-28", endDate: "01-03", title: "毕设开题方案设计", details: "研究目标与技术路线", outcome: "开题报告提纲", startTime: null, endTime: null },
          { sourceIndex: 3, rowIndex: 1, startDate: "01-04", endDate: "01-08", title: "开题报告撰写", details: "同步制作PPT", outcome: "开题报告及PPT初稿", startTime: null, endTime: null }
        ],
        request: { createEvents: true, createMemo: true, createFolders: true, scope: "all", allDay: true, reminderEnabled: false },
        selectedRows: null, folderNames: ["毕设"], memoRequest: { title: "开题前准备", folderName: "毕设", format: "checklist" }, uncertainties: []
      };
      const providerCalls: Array<Record<string, unknown>> = [];
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg" });
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "test-user-id" });
        if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json([{ enabled: true, role: "admin", expires_at: null }]);
        if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
        if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") return Response.json({ allowed: true, todayRequests: 1, weekRequests: 1 });
        if (url.pathname === "/rest/v1/ai_assistant_usage") return new Response(null, { status: 204 });
        if (request.url === "https://mimo-provider.invalid/v1/chat/completions") {
          providerCalls.push(await request.json());
          const responsePayload = payload.rows ? { answer: "任务已整理", actions: [], attachmentPlan: payload } : payload;
          return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(responsePayload) } }], usage: { total_tokens: 30 } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      };
      const result = await invoke({
        question: "按图片记录到全天事项，不用提醒，创建毕设文件夹和开题前准备备忘录，用可勾选待办",
        attachments: ["aW1hZ2Ux", "aW1hZ2Uy", "aW1hZ2Uz"].map((value) => ({ name: "image.png", kind: "image", dataUrl: `data:image/png;base64,${value}` }))
      });
      assertEquals(result.actions.length, 5);
      assertEquals(result.actions[1].startDate, "2026-12-28");
      assertEquals(result.actions[1].endDate, "2027-01-03");
      assertEquals(result.actions[2].startDate, "2027-01-04");
      assertEquals(result.actions[3], { type: "create_memo_folder", name: "毕设" });
      assertEquals(result.actions[4].items.length, 3);
      assertEquals(result.actions[4].folderName, "毕设");
      const messages = providerCalls[0].messages as Array<{ content: string | Array<{ type: string }> }>;
      assertEquals((messages[1].content as Array<{ type: string }>).filter((part) => part.type === "image_url").length, 3);
      assertEquals(providerCalls[0].max_completion_tokens, 16000);
      const importBody = {
        question: "按图片记录到全天事项，不用提醒，创建毕设文件夹和开题前准备备忘录，用可勾选待办",
        attachments: ["aW1hZ2Ux", "aW1hZ2Uy", "aW1hZ2Uz"].map((value) => ({ name: "image.png", kind: "image", dataUrl: `data:image/png;base64,${value}` }))
      };
      const originalPlan = payload;
      payload = {
        ...originalPlan,
        sourceRowCounts: (originalPlan.sourceRowCounts as Array<{ sourceIndex: number; count: number }>).map((source) => ({ sourceIndex: String(source.sourceIndex), count: String(source.count) })),
        rows: (originalPlan.rows as Array<Record<string, unknown>>).map((row) => ({ ...row, title: { text: row.title }, details: [row.details], outcome: { value: row.outcome } })),
        folderNames: [{ name: "毕设" }],
        memoRequest: { title: { text: "开题前准备" }, folderName: { name: "毕设" }, format: "checklist" }
      };
      const variantResult = await invoke(importBody);
      assertEquals(variantResult.actions, result.actions, "Common model field representations must produce identical records");
      const continuedResult = await invoke({ ...importBody, question: "剩下的也按刚才的意思办好", history: [{ role: "user", content: importBody.question }, { role: "assistant", content: "第一张图已处理" }] });
      assertEquals(continuedResult.actions, result.actions, "Continuation wording must not select a different code path");
      const continuationPrompt = (providerCalls.at(-1)!.messages as Array<{ content: unknown }>)[1].content as Array<{ type: string; text?: string }>;
      assert(continuationPrompt.some((part) => part.text?.includes(importBody.question)), "The model needs original task context");
      payload = { answer: "这里有三份附件，第二份包含四条任务。", actions: [], attachmentPlan: null };
      const explanation = await invoke({ ...importBody, question: "不用创建，只解释图里的安排" });
      assertEquals(explanation.actions, []);
      assertEquals(explanation.answer, payload.answer);
      payload = { ...originalPlan, rows: (originalPlan.rows as Array<Record<string, unknown>>).map((row, index) => index === 0 ? { ...row, title: { invalid: "任务" } } : row) };
      const malformedImport = await handler!(new Request("https://edge.invalid/ai-assistant", {
        method: "POST", headers: { authorization: "Bearer test-user-token", "content-type": "application/json" }, body: JSON.stringify(importBody)
      }));
      const malformedBody = await malformedImport.json();
      assert(!malformedImport.ok);
      assert(malformedBody.error.includes("第 1 份附件第 1 行的标题"));
      assert(!malformedBody.error.includes("分批"));
      assertEquals(malformedBody.actions, undefined);
      payload = { answer: "将创建文件夹与清单", actions: [
        { type: "create_memo_folder", name: "毕设" },
        { type: "create_memo", title: "开题前准备", folderName: "毕设", format: "checklist", items: [{ text: "查文献", completed: false }] }
      ] };
      const memoResult = await invoke({ question: "创建毕设文件夹和开题前准备备忘录，使用可勾选清单" });
      assertEquals(memoResult.actions[0], { type: "create_memo_folder", name: "毕设" });
      assertEquals(memoResult.actions[1].folderName, "毕设");
      assertEquals(memoResult.actions[1].format, "checklist");
      assertEquals(memoResult.actions[1].items, [{ text: "查文献", completed: false }]);
      payload = { answer: "已全部完成", actions: [{ type: "unsupported_action", title: "不应执行" }] };
      const invalid = await handler!(new Request("https://edge.invalid/ai-assistant", {
        method: "POST", headers: { authorization: "Bearer test-user-token", "content-type": "application/json" },
        body: JSON.stringify({ question: "创建事项" })
      }));
      assert(!invalid.ok, "Unsupported actions must fail instead of being silently dropped");
    });
    await t.step("large images use owned temporary URLs and validate stored size before a model call", async () => {
      const originalSend = S3Client.prototype.send;
      const imageKey = "ai-images/test-user-id/11111111-1111-4111-8111-111111111111.png";
      const imageSize = 8 * 1024 * 1024;
      let actualSize = imageSize;
      let providerCalls = 0;
      let deleted = 0;
      S3Client.prototype.send = (async (command: unknown) => {
        if (command instanceof HeadObjectCommand) return { ContentLength: actualSize };
        if (command instanceof DeleteObjectCommand) { deleted++; return {}; }
        throw new Error("Unexpected storage operation");
      }) as typeof S3Client.prototype.send;
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg" });
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "test-user-id" });
        if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json([{ enabled: true, role: "admin", expires_at: null }]);
        if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
        if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") return Response.json({ allowed: true, todayRequests: 1, weekRequests: 1 });
        if (url.pathname === "/rest/v1/ai_assistant_usage") return new Response(null, { status: 204 });
        if (url.hostname === "mimo-provider.invalid") {
          providerCalls++;
          const body = await request.json();
          const image = body.messages[1].content.find((part: { type: string }) => part.type === "image_url");
          assert(new URL(image.image_url.url).hostname.endsWith("r2.invalid"), "Provider must receive the signed owned-image URL");
          assert(!image.image_url.url.includes("base64"));
          return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"answer":"图片说明","actions":[]}' } }] });
        }
        throw new Error("Unexpected mocked request");
      };
      const rawInvoke = (body: Record<string, unknown>) => handler!(new Request("https://edge.invalid/ai-assistant", { method: "POST", headers: { authorization: "Bearer test-user-token", "content-type": "application/json" }, body: JSON.stringify(body) }));
      try {
        const ticket = await invoke({ action: "create_image_upload", image: { name: "image.png", mimeType: "image/png", size: imageSize } });
        assert(ticket.uploadUrl.startsWith("https://"));
        assertEquals(providerCalls, 0);
        await invoke({ question: "解释图片", attachments: [{ kind: "image", name: "image.png", imageObjectKey: imageKey, imageSize }] });
        assertEquals(providerCalls, 1);
        actualSize--;
        assert(!(await rawInvoke({ question: "解释图片", attachments: [{ kind: "image", imageObjectKey: imageKey, imageSize }] })).ok);
        assertEquals(providerCalls, 1);
        assertEquals((await rawInvoke({ action: "delete_image_upload", image: { objectKey: imageKey.replace("test-user-id", "another-user") } })).status, 400);
        assertEquals(deleted, 0);
        await invoke({ action: "delete_image_upload", image: { objectKey: imageKey } });
        assertEquals(deleted, 1);
      } finally { S3Client.prototype.send = originalSend; }
    });
    await t.step("client document usage cannot poison the global AI budget", async () => {
      const loggedUsage: Array<Record<string, unknown>> = [];
      const unexpectedCalls: string[] = [];
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") {
          return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg" });
        }
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "test-user-id" });
        if (url.pathname === "/rest/v1/ai_assistant_access") {
          return Response.json([{ enabled: true, role: "member", expires_at: null }]);
        }
        if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
        if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") {
          return Response.json({ allowed: true, todayRequests: 0, weekRequests: 0 });
        }
        if (url.pathname === "/rest/v1/ai_assistant_usage") {
          loggedUsage.push(await request.json());
          return new Response(null, { status: 204 });
        }
        if (request.url === "https://mimo-provider.invalid/v1/chat/completions") {
          return Response.json({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "文档回答", actions: [] }) } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          });
        }
        unexpectedCalls.push(request.url);
        throw new Error(`Unexpected mocked request: ${request.url}`);
      };
      await invoke({
        question: "总结文档",
        attachments: [{
          kind: "document",
          name: "processed.pdf",
          text: "已提取的文档内容",
          processedPageCount: 25,
          processingUsage: { prompt_tokens: 50_000_000, completion_tokens: 50_000_000, total_tokens: 100_000_000 },
        }],
      });
      assertEquals(loggedUsage.length, 1);
      assertEquals(loggedUsage[0].total_tokens, 30, "Only usage observed server-side in this request may be charged");
      assertEquals(loggedUsage[0].prompt_tokens, 20);
      assertEquals(loggedUsage[0].completion_tokens, 10);
      assertEquals(unexpectedCalls, []);
    });
    await t.step("anniversary fields keep null instead of fabricating lunar 1900-01-01", async () => {
      const rawActions = [
        { type: "update_anniversary", title: "甲生日", reminderDaysBefore: 3, calendarType: null,
          lunarYear: null, lunarMonth: null, lunarDay: null, lunarIsLeapMonth: null },
        { type: "create_anniversary", title: "乙生日", calendarType: "solar", date: "2005-10-05",
          lunarYear: null, lunarMonth: null, lunarDay: null },
        { type: "create_anniversary", title: "丙生日", calendarType: "lunar", date: null,
          lunarYear: 2005, lunarMonth: 2, lunarDay: 25, lunarIsLeapMonth: false },
        { type: "update_anniversary", title: "丁生日", calendarType: "lunar",
          lunarYear: 2026.5, lunarMonth: 13, lunarDay: "25" }
      ];
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === "/rest/v1/rpc/get_ai_runtime_settings") {
          return Response.json({ provider: "mimo", model: "mimo-v2.6-flash", mimo_channel: "payg" });
        }
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "test-user-id" });
        if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json([{ enabled: true, role: "admin", expires_at: null }]);
        if (url.pathname === "/rest/v1/rpc/check_ai_global_budget") return Response.json({ allowed: true });
        if (url.pathname === "/rest/v1/rpc/reserve_ai_usage") return Response.json({ allowed: true, todayRequests: 1, weekRequests: 1 });
        if (url.pathname === "/rest/v1/ai_assistant_usage") return new Response(null, { status: 204 });
        if (request.url === "https://mimo-provider.invalid/v1/chat/completions") {
          return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "修改日期", actions: rawActions }) } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
        }
        throw new Error(`Unexpected mocked request: ${request.url}`);
      };
      const result = await invoke({ question: "调整生日和提醒" });
      assertEquals(result.actions.length, 4);
      for (const index of [0, 1, 3]) {
        assertEquals(result.actions[index].lunarYear, null);
        assertEquals(result.actions[index].lunarMonth, null);
        assertEquals(result.actions[index].lunarDay, null);
      }
      assertEquals(result.actions[0].lunarIsLeapMonth, null);
      assertEquals(result.actions[0].reminderDaysBefore, 3);
      assertEquals(result.actions[2].lunarYear, 2005);
      assertEquals(result.actions[2].lunarMonth, 2);
      assertEquals(result.actions[2].lunarDay, 25);
      assertEquals(result.actions[2].calendarType, "lunar");
    });
  } finally {
    Deno.resolveDns = originalDns;
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
