import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ConfigEnv, UserConfig } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../../vite.config";

const makeConfig = viteConfig as (environment: ConfigEnv) => UserConfig;
const projectUrl = "https://haifsnaupqhlvgfoyvlc.supabase.co";
const publicKey = "sb_publishable_abcdefghijklmnopqrstuvwxyz012345";
let fixtureDirectory: string;

function buildConfig(mode = "cloudflare", command: "build" | "serve" = "build") {
  return makeConfig({ command, mode });
}

function writeEnvironment(name: string, url = projectUrl, key = publicKey) {
  writeFileSync(join(fixtureDirectory, name), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`);
}

describe("发布构建云端配置", () => {
  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "schedule-cloud-build-"));
    vi.spyOn(process, "cwd").mockReturnValue(fixtureDirectory);
    vi.stubEnv("REQUIRE_RELEASE_NOTES", "true");
    vi.stubEnv("VITE_SUPABASE_URL", undefined);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    const temporaryRoot = resolve(tmpdir());
    if (dirname(fixtureDirectory) !== temporaryRoot || !basename(fixtureDirectory).startsWith("schedule-cloud-build-")) {
      throw new Error("Unexpected cloud build fixture directory");
    }
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("Cloudflare 发布不能误用仅写在 production 模式文件中的配置", () => {
    writeEnvironment(".env.production.local");
    expect(() => buildConfig()).toThrow(/VITE_SUPABASE/);
    expect(() => buildConfig("production")).not.toThrow();
  });

  it("Cloudflare 模式文件或所有模式的本地文件均可提供发布配置", () => {
    writeEnvironment(".env.cloudflare.local");
    expect(() => buildConfig()).not.toThrow();
    rmSync(join(fixtureDirectory, ".env.cloudflare.local"));
    writeEnvironment(".env.local");
    expect(() => buildConfig()).not.toThrow();
  });

  it("发布环境可直接注入云端配置并覆盖模式文件", () => {
    writeEnvironment(".env.cloudflare.local", "https://your-project-ref.supabase.co", "sb_publishable_your_key");
    vi.stubEnv("VITE_SUPABASE_URL", projectUrl);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", publicKey);
    expect(() => buildConfig()).not.toThrow();
  });

  it.each([
    [undefined, publicKey],
    [projectUrl, undefined],
    ["https://your-project-ref.supabase.co", publicKey],
    [projectUrl, "sb_publishable_your_key"],
    ["not-a-url", publicKey],
    ["file:///cloud-service", publicKey]
  ])("发布拒绝缺失、占位或无效配置 %#", (url, key) => {
    vi.stubEnv("VITE_SUPABASE_URL", url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", key);
    expect(() => buildConfig()).toThrow(/VITE_SUPABASE/);
  });

  it("发布不允许将私密 Supabase 密钥打包为公开客户端配置", () => {
    vi.stubEnv("VITE_SUPABASE_URL", projectUrl);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_not_a_real_secret_key");
    expect(() => buildConfig()).toThrow(/VITE_SUPABASE/);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", `${header}.${payload}.not-a-real-signature`);
    expect(() => buildConfig()).toThrow(/VITE_SUPABASE/);
  });

  it("开发和未启用发布要求的离线构建仍可不配置云端", () => {
    expect(() => buildConfig("development", "serve")).not.toThrow();
    vi.stubEnv("REQUIRE_RELEASE_NOTES", "false");
    expect(() => buildConfig()).not.toThrow();
  });
});
