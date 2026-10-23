import { assert, assertEquals } from "jsr:@std/assert@1";

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
  };
  const previousEnvironment = new Map(
    Object.keys(testEnvironment).map((name) => [name, Deno.env.get(name)]),
  );
  const originalServe = Deno.serve;
  const originalFetch = globalThis.fetch;
  let handler: Handler | undefined;

  try {
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
          assertEquals(body.max_completion_tokens, 1400);
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
          assertEquals(messages[1].content[0], {
            type: "image_url",
            image_url: { url: imageUrl },
          });
        } else {
          assertEquals(body.max_tokens, 1400);
          assertEquals(body.max_completion_tokens, undefined);
        }
        assertEquals(unexpectedCalls, []);
      });
    }
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
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
