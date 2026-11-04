import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Execute the actual guarded workflow script with every external dependency
// injected. This must never create users, upload objects or call a real model.
async function executeSmoke(countedRows: number) {
  const requests: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const response = (value: unknown) => new Response(JSON.stringify(value));
  const fetchMock = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
    if (url.includes("/functions/v1/ai-assistant")) {
      const body = JSON.parse(options?.body ?? "{}");
      requests.push(body);
      if (body.action === "plan_audio_transcription") return response({ strategy: "progressive", tasks: [0, 1].map((chunkIndex) => ({ chunkIndex, signature: `range-${chunkIndex}` })) });
      if (body.action === "plan_audio_parts") return response({ tasks: body.audios.map((audio: unknown, partIndex: number) => ({ ...(audio as object), partIndex, signature: `part-${partIndex}` })) });
      if (body.action.startsWith("transcribe_audio_")) return response({ transcript: "这是用于离线验证顺序与计次的测试正文。".repeat(20) });
      if (body.action === "finalize_audio_transcription") return response({
        transcript: body.audioSegmentResults.map((file: { name: string; segments: string[] }) => `${file.name}\n${file.segments.join("\n")}`).join("\n"),
        summary: "完整音频提交的测试摘要，不调用任何真实的语音或文本模型。", model: "mock-only"
      });
      if (body.action === "close_audio_submission") return response({ ok: true });
      throw new Error(`Unexpected action ${body.action}`);
    }
    if (url.includes("/auth/v1/admin/users")) {
      if (options?.method === "DELETE") deleted.push(url);
      return response(options?.method === "POST" ? { id: "test-user" } : { users: [] });
    }
    if (url.includes("/auth/v1/token")) return response({ access_token: "test-token" });
    if (url.includes("/rest/v1/ai_assistant_access")) return new Response(null, { status: 204 });
    if (url.includes("/rest/v1/ai_assistant_usage?")) {
      expect(url).toContain("quota_counted=eq.true");
      return response(Array.from({ length: countedRows }, (_, index) => ({ diagnostic_id: `diagnostic-${index}` })));
    }
    throw new Error(`Unexpected endpoint ${url}`);
  });
  class HeadObjectCommand { constructor(public input: Record<string, unknown>) {} }
  class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
  class DeleteObjectCommand { constructor(public input: Record<string, unknown>) {} }
  class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
  class CopyObjectCommand { constructor(public input: Record<string, unknown>) {} }
  class S3Client {
    async send(command: { input: Record<string, unknown> }) {
      if (command instanceof HeadObjectCommand) return { ContentLength: 8_000_000 };
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array(10) } };
      if (command instanceof DeleteObjectCommand) deleted.push(String(command.input.Key));
      return {};
    }
  }
  const env = Object.fromEntries(["SUPABASE_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY", "R2_BUCKET", "SOURCE_KEY_1", "SOURCE_KEY_2", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].map((key) => [key, key === "SUPABASE_URL" ? "https://mock.invalid" : key]));
  const dependencies = { crypto: { randomUUID: () => crypto.randomUUID() }, execFileSync: vi.fn(),
    mkdtemp: async () => "mock-temp", readFile: async () => new Uint8Array(1000),
    readdir: async () => ["part-000.wav", "part-001.wav"], rm: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined),
    tmpdir: () => "mock-temp", join: (...parts: string[]) => parts.join("/"),
    CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
    process: { env }, fetch: fetchMock, console: { log: vi.fn(), error: vi.fn() } };
  const source = readFileSync(resolve(process.cwd(), "scripts/smoke-audio-transcription.mjs"), "utf8").replace(/^import .*;\r?\n/gm, "");
  const run = new Function(...Object.keys(dependencies), `return (async () => { ${source}\n })();`);
  let error: unknown;
  try { await run(...Object.values(dependencies)); } catch (cause) { error = cause; }
  return { requests, deleted, error };
}

describe("真实音频验收脚本的离线契约检查", () => {
  it("所有付费阶段复用同一个提交并核对一次计次", async () => {
    const { requests, deleted, error } = await executeSmoke(1);
    expect(error).toBeUndefined();
    const paid = requests.filter((body) => String(body.action).startsWith("transcribe_audio_") || body.action === "finalize_audio_transcription");
    expect(paid).toHaveLength(5);
    const submission = paid[0].audioSubmission as { id: string; audios: unknown[] };
    expect(submission.audios).toHaveLength(3);
    for (const body of paid) expect(body.audioSubmission).toEqual(submission);
    expect(requests.at(-1)).toEqual({ action: "close_audio_submission", audioSubmissionId: submission.id });
    expect(deleted).toContain("SOURCE_KEY_1");
    expect(deleted.some((item) => item.includes("/auth/v1/admin/users/test-user"))).toBe(true);
  });

  it("多扣次数保持失败，保留源录音并清理派生对象和临时账号", async () => {
    const { requests, deleted, error } = await executeSmoke(2);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("exactly one quota attempt");
    expect(requests.at(-1)?.action).toBe("close_audio_submission");
    expect(deleted).not.toContain("SOURCE_KEY_1");
    expect(deleted.filter((item) => item.startsWith("ai-audio/test-user/"))).toHaveLength(3);
    expect(deleted.some((item) => item.includes("/auth/v1/admin/users/test-user"))).toBe(true);
  });
});
