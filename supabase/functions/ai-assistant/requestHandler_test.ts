import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { createAiRequestHandler } from "./requestHandler.ts";
import { DiagnosticError, emptyUsage, jsonResponse, PublicHttpError, type AiRequestContext, type AiUsageLogInput } from "./requestContext.ts";

function fixture(dispatch: (context: AiRequestContext) => Promise<Response>) {
  const calls: string[] = [];
  const logs: AiUsageLogInput[] = [];
  const services = {
    serviceRoleSecret: () => "test-key",
    getAiSettings: async () => { calls.push("settings"); return null; },
    getUser: async (authorization: string) => { calls.push("user"); return { id: authorization.slice(7) }; },
    dispatch,
    combineUsage: (left: ReturnType<typeof emptyUsage>, right: ReturnType<typeof emptyUsage>) => ({
      prompt_tokens: left.prompt_tokens + right.prompt_tokens,
      completion_tokens: left.completion_tokens + right.completion_tokens,
      total_tokens: left.total_tokens + right.total_tokens,
      estimated_cost_cny: null
    }),
    usageFromDiagnosticDetails: (details: Record<string, unknown>) => details.providerUsage as ReturnType<typeof emptyUsage> ?? emptyUsage(),
    logAiAssistantUsage: async (input: AiUsageLogInput) => { logs.push(input); }
  };
  return { services, calls, logs };
}

function request(userId: string, body: Record<string, unknown> = {}) {
  return new Request("https://edge.invalid/ai-assistant", {
    method: "POST", headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" }, body: JSON.stringify(body)
  });
}

Deno.test("request handler can be tested without loading the server entrypoint or global environment", async () => {
  const original = request("user-a", { action: "configuration" });
  const { services, calls } = fixture(async (context) => {
    assertEquals(context.request, original);
    assertEquals(context.user.id, "user-a");
    assertEquals(context.body.action, "configuration");
    assertEquals(context.state.currentUser, context.user);
    assertEquals(context.state.featureKey, "assistant");
    assertEquals(context.state.submissionQuota, undefined);
    calls.push("dispatch");
    return jsonResponse({ ok: true });
  });
  const response = await createAiRequestHandler(services)(original);
  assertEquals(response.status, 200);
  assertEquals(calls, ["settings", "user", "dispatch"]);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});

Deno.test("concurrent requests isolate feature, quota, usage and diagnostic state", async () => {
  const contexts: AiRequestContext[] = [];
  let bothEntered!: () => void;
  const entered = new Promise<void>((resolve) => { bothEntered = resolve; });
  const { services, logs } = fixture(async (context) => {
    assertEquals(context.state.submissionQuota, undefined);
    context.state.featureKey = context.user.id === "audio" ? "audio_transcription" : "mind_map";
    context.state.accessMethod = context.user.id === "audio" ? "member" : "admin";
    context.state.questionChars = context.user.id === "audio" ? 15 : 25;
    context.state.observedUsage = { ...emptyUsage(), total_tokens: context.state.questionChars };
    if (context.user.id === "audio") {
      context.state.submissionQuota = { allowed: true, usageKnown: true, limits: { daily: 1, weekly: 2 } };
    }
    contexts.push(context);
    if (contexts.length === 2) bothEntered();
    await entered;
    if (context.user.id === "audio") throw new PublicHttpError("audio failure", 409);
    assertEquals(context.state.submissionQuota, undefined);
    throw new DiagnosticError("document failure", { stage: "document_extract", providerUsage: { ...emptyUsage(), total_tokens: 7 } });
  });
  const handler = createAiRequestHandler(services);
  const [audio, document] = await Promise.all([handler(request("audio")), handler(request("document"))]);
  assertEquals(audio.status, 409);
  assertEquals(document.status, 500);
  assertNotEquals(contexts[0].state, contexts[1].state);
  const audioLog = logs.find((log) => log.userId === "audio")!;
  const documentLog = logs.find((log) => log.userId === "document")!;
  assertEquals(audioLog.featureKey, "audio_transcription");
  assertEquals(documentLog.featureKey, "mind_map");
  assertEquals(audioLog.accessMethod, "member");
  assertEquals(documentLog.accessMethod, "admin");
  assertEquals(audioLog.usage.total_tokens, 15);
  assertEquals(documentLog.usage.total_tokens, 32);
  assertNotEquals(audioLog.diagnosticId, documentLog.diagnosticId);
  assertEquals((await audio.json()).diagnosticId, audioLog.diagnosticId);
  assertEquals((await document.json()).diagnosticId, documentLog.diagnosticId);
});

Deno.test("authentication failure never dispatches or writes another user's usage", async () => {
  const { services, logs } = fixture(async () => { throw new Error("dispatch must not run"); });
  services.getUser = async () => { throw new PublicHttpError("请重新登录。", 401); };
  const response = await createAiRequestHandler(services)(request("unauthorized"));
  assertEquals(response.status, 401);
  assertEquals(logs, []);
  assert(typeof (await response.json()).diagnosticId === "string");
});
