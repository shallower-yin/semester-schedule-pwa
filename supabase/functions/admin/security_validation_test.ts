import { assert, assertEquals } from "jsr:@std/assert@1";

// Offline safety audit: all HTTP/DNS is replaced. Known guard bypass stays red.
Deno.test("admin authorization and relay destination security", async (t) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const env = { SUPABASE_URL: "https://admin-security.invalid", SUPABASE_PUBLISHABLE_KEYS: '{"default":"test"}', SERVICE_ROLE_KEY: "test-service" };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  const previous = { fetch: globalThis.fetch, serve: Deno.serve, dns: Deno.resolveDns, error: console.error };
  let handler!: (request: Request) => Promise<Response>;
  let access: Record<string, unknown> = { user_id: userId, enabled: true, role: "member", expires_at: null };
  let calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    Deno.serve = ((callback: (request: Request) => Promise<Response>) => {
      handler = callback;
      return {} as Deno.HttpServer;
    }) as typeof Deno.serve;
    Deno.resolveDns = (async (hostname: string, type: string) => {
      if (hostname.includes(":")) throw new Error("literal is not a DNS hostname");
      return type === "A" ? [hostname === "private.example" ? "10.0.0.1" : "93.184.216.34"] : [];
    }) as typeof Deno.resolveDns;
    console.error = () => {};
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assertEquals(url.hostname, "admin-security.invalid", "unexpected network destination");
      const body = request.method === "POST" || request.method === "PUT" ? await request.json() : null;
      calls.push({ method: request.method, path: url.pathname, body });
      if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
      if (url.pathname === "/rest/v1/ai_assistant_access") return Response.json([access]);
      if (url.pathname.startsWith("/storage/v1/object/list/")) return Response.json([]);
      if (url.pathname === `/auth/v1/admin/users/${userId}` && request.method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname === "/rest/v1/rpc/admin_upsert_ai_provider_relay") return Response.json({
        id: "33333333-3333-4333-8333-333333333333", name: body.p_name, base_url: body.p_base_url,
        protocol: body.p_protocol, supports_text: body.p_supports_text, text_model: body.p_text_model
      });
      throw new Error(`Unexpected mock operation: ${request.method} ${url.pathname}`);
    };
    await import("./index.ts");
    const invoke = async (body: unknown, token = "Bearer test") => {
      const response = await handler(new Request("https://edge.invalid/admin", {
        method: "POST", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify(body)
      }));
      return { status: response.status, body: await response.json() };
    };
    const saveRelay = (baseUrl: string) => invoke({ action: "save-ai-relay", relay: {
      name: "offline test", protocol: "openai_compatible", baseUrl,
      apiKey: "test-only", supportsText: true, textModel: "test", supportsAudio: false
    } });

    await t.step("missing login and non-admin/expired/disabled roles cannot mutate admin data", async () => {
      assertEquals((await invoke({ action: "set-ai-access", targetUserId: otherId, access: { role: "admin", enabled: true } }, "")).status, 401);
      assertEquals(calls.length, 0);
      for (const patch of [
        { enabled: true, role: "member", expires_at: null },
        { enabled: false, role: "admin", expires_at: null },
        { enabled: true, role: "admin", expires_at: "2000-01-01T00:00:00.000Z" }
      ]) {
        access = { user_id: userId, ...patch };
        for (const action of ["summary", "set-ai-access", "save-ai-relay", "set-account-ban"]) {
          assertEquals((await invoke({ action, targetUserId: otherId, access: { role: "admin", enabled: true } })).status, 403);
        }
      }
      assert(calls.every((call) => call.method === "GET"));
    });

    await t.step("self deletion ignores a forged target account", async () => {
      calls = [];
      assertEquals((await invoke({ action: "delete-my-account", targetUserId: otherId })).status, 200);
      const deletes = calls.filter((call) => call.method === "DELETE");
      assertEquals(deletes.map((call) => call.path), [`/auth/v1/admin/users/${userId}`]);
      assert(calls.filter((call) => call.path.startsWith("/storage/")).every((call) => call.body?.prefix === userId));
    });

    await t.step("private IPv4 IPv6 and DNS destinations never reach relay persistence", async () => {
      access = { user_id: userId, enabled: true, role: "admin", expires_at: null };
      for (const url of ["http://public.example/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.1/v1", "https://[::1]/v1", "https://private.example/v1"]) {
        calls = [];
        assert((await saveRelay(url)).status >= 400, `must reject ${url}`);
        assert(!calls.some((call) => call.path.includes("admin_upsert")));
      }
    });

    await t.step("IPv4-mapped IPv6 loopback must not bypass the private address guard", async () => {
      calls = [];
      const response = await saveRelay("https://[::ffff:127.0.0.1]/v1");
      const writes = calls.filter((call) => call.path.includes("admin_upsert"));
      console.log("mapped-loopback observation", { status: response.status, writes: writes.length, savedUrl: writes[0]?.body?.p_base_url });
      assert(response.status >= 400, "IPv4-mapped loopback relay address was accepted");
      assertEquals(writes.length, 0);
    });
  } finally {
    globalThis.fetch = previous.fetch;
    Deno.serve = previous.serve;
    Deno.resolveDns = previous.dns;
    console.error = previous.error;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
