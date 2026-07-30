import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { SignatureV4 } from "@smithy/signature-v4";
import { afterEach, describe, expect, it } from "vitest";

const relevantEnvironment = [
  "SUPABASE_URL",
  "PUBLISHABLE_KEY",
  "SERVICE_ROLE_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "SOURCE_KEY_1",
  "SOURCE_KEY_2",
  "SMOKE_PAGE_COUNT",
  "GITHUB_OUTPUT",
  "GITHUB_STEP_SUMMARY"
];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  })));
});

describe("production smoke preflight", () => {
  it("skips missing prerequisites without creating a failed process", async () => {
    const result = await runPreflight({ SMOKE_KIND: "audio" });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('{"ready":"false"}');
    expect(result.stdout).toContain("缺少运行配置");
  });

  it("verifies fresh audio objects with a valid R2 SigV4 HEAD before starting", async () => {
    const headRequests: IncomingMessage[] = [];
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/auth/v1/admin/users")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"users":[]}');
        return;
      }
      if (request.url === "/functions/v1/ai-assistant" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"maxDocumentPages":120}');
        return;
      }
      if (request.method === "HEAD" && request.url?.startsWith("/smoke-bucket/codex-smoke-source/request-12345/")) {
        headRequests.push(request);
        response.writeHead(200, {
          "content-length": "9000000",
          "last-modified": new Date().toUTCString()
        });
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const endpoint = `http://127.0.0.1:${port}`;

    const result = await runPreflight({
      SMOKE_KIND: "audio",
      SUPABASE_URL: endpoint,
      PUBLISHABLE_KEY: "publishable-test",
      SERVICE_ROLE_KEY: "service-test",
      R2_ENDPOINT: endpoint,
      R2_BUCKET: "smoke-bucket",
      R2_ACCESS_KEY_ID: "access-test",
      R2_SECRET_ACCESS_KEY: "secret-test",
      SOURCE_KEY_1: "codex-smoke-source/request-12345/audio-1.mp3",
      SOURCE_KEY_2: "codex-smoke-source/request-12345/audio-2.m4a"
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('{"ready":"true"}');
    expect(headRequests).toHaveLength(2);
    for (const request of headRequests) {
      await expectValidSignature(request, port);
    }
  });
});

async function runPreflight(overrides: Record<string, string>) {
  const environment = { ...process.env };
  for (const name of relevantEnvironment) delete environment[name];
  Object.assign(environment, overrides);

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve("scripts/preflight-production-smoke.mjs")], {
      cwd: process.cwd(),
      env: environment
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not receive a TCP port");
  return address.port;
}

async function expectValidSignature(request: IncomingMessage, port: number) {
  const amzDate = String(request.headers["x-amz-date"] || "");
  const contentHash = String(request.headers["x-amz-content-sha256"] || "");
  const host = String(request.headers.host || "");
  const signer = new SignatureV4({
    credentials: { accessKeyId: "access-test", secretAccessKey: "secret-test" },
    region: "auto",
    service: "s3",
    sha256: NodeSha256
  });
  const signed = await signer.sign({
    method: "HEAD",
    protocol: "http:",
    hostname: "127.0.0.1",
    port,
    path: request.url || "/",
    headers: {
      host,
      "x-amz-content-sha256": contentHash,
      "x-amz-date": amzDate
    }
  }, { signingDate: parseAmzDate(amzDate) });

  expect(request.headers.authorization).toBe(signed.headers.authorization);
}

function parseAmzDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) throw new Error(`invalid x-amz-date: ${value}`);
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ));
}

class NodeSha256 {
  private hash;

  constructor(secret?: unknown) {
    this.hash = secret === undefined
      ? createHash("sha256")
      : createHmac("sha256", toBuffer(secret));
  }

  update(value: unknown) {
    this.hash.update(toBuffer(value));
  }

  async digest() {
    return this.hash.digest();
  }
}

function toBuffer(value: unknown) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value as ArrayBuffer);
}
