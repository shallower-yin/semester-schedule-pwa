import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MAX_AI_BODY_BYTES, readAiRequest } from "./requestValidation.ts";
import { PublicHttpError } from "./requestContext.ts";
import { createAiRequestHandler } from "./requestHandler.ts";
import { emptyUsage } from "./requestContext.ts";
import type { AiSettingsRow } from "./requestTypes.ts";
const request = (value: unknown) => new Request("https://edge.invalid", { method: "POST", body: JSON.stringify(value) });

Deno.test("AI input bounds preserve legitimate text media and legacy audio manifests", async () => {
  const valid = { question: "x".repeat(20_000), history: Array.from({ length: 5 }, () => ({ role: "user", content: "x".repeat(20_000) })),
    audioTranscript: "t".repeat(1_000_000), audio: { dataUrl: "data:audio/wav;base64," + "A".repeat(10 * 1024 * 1024), name: "test.wav", size: 100 },
    attachments: [{ kind: "image", dataUrl: "data:image/png;base64," + "A".repeat(8_388_608) }, { kind: "document", text: "d".repeat(100_000), pageImages: Array.from({ length: 24 }, () => "data:image/jpeg;base64," + "A".repeat(200_000)) }],
    audioSubmission: { id: crypto.randomUUID(), audios: [{ name: "test.wav", mimeType: "audio/wav", size: 100, objectKey: "ai-audio/user/file.wav" }], language: "zh", summarize: true } };
  const parsed = await readAiRequest(request(valid));
  assertEquals(parsed.question?.length, 20_000); assertEquals(parsed.attachments?.[1].pageImages?.length, 24);
  for (const body of [{ question: "x".repeat(20_001) }, { history: Array.from({ length: 51 }, () => ({ role: "user", content: "x" })) }, { history: Array.from({ length: 6 }, () => ({ role: "user", content: "x".repeat(20_000) })) }]) await assertRejects(() => readAiRequest(request(body)), PublicHttpError);
  for (const body of [null, [], { question: 3 }, { history: [{}] }, { audio: [] }, { attachments: [null] }, { document: { pages: [null] } }]) await assertRejects(() => readAiRequest(request(body)), PublicHttpError);
});

Deno.test("stream bounds count bytes despite absent or forged Content-Length and cancel early", async () => {
  for (const length of [undefined, "1"]) {
    let cancelled = false, reads = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(600).fill(32)); }, cancel() { cancelled = true; } });
    const req = new Request("https://edge.invalid", { method: "POST", body: stream, headers: length ? { "content-length": length } : {} });
    await assertRejects(() => readAiRequest(req, 1024), PublicHttpError);
    assertEquals(cancelled, true); assertEquals(reads <= 3, true);
  }
  await assertRejects(() => readAiRequest(new Request("https://edge.invalid", { method: "POST", headers: { "content-length": String(MAX_AI_BODY_BYTES + 1) }, body: "{}" })), PublicHttpError);
  await assertRejects(() => readAiRequest(new Request("https://edge.invalid", { method: "POST", body: "[".repeat(65) })), PublicHttpError);
});

Deno.test("unused relay does not block dispatch; invalid input still cannot reach admission", async () => {
  let dispatched = 0;
  const handler = createAiRequestHandler({
    serviceRoleSecret: () => "test", getUser: async () => ({ id: "user" }),
    getAiSettings: async () => ({ text_relay: { base_url: "https://[::ffff:127.0.0.1]/v1" } } as AiSettingsRow),
    dispatch: async () => { dispatched++; return Response.json({ ok: true }); },
    combineUsage: () => emptyUsage(), usageFromDiagnosticDetails: () => emptyUsage(), logAiAssistantUsage: async () => {}
  });
  const config = request({ action: "configuration" }); config.headers.set("authorization", "Bearer test");
  assertEquals((await handler(config)).status, 200);
  for (const body of [{ question: "x".repeat(20_001) }, { history: [{ role: "user", content: 42 }] }]) {
    const original = request(body);
    original.headers.set("authorization", "Bearer test");
    assertEquals((await handler(original)).status >= 400, true);
  }
  assertEquals(dispatched, 1);
});
