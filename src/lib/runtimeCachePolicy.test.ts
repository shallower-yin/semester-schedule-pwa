import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../vite.config";

vi.mock("@vitejs/plugin-react", () => ({ default: () => ({ name: "react-test" }) }));
vi.mock("vite-plugin-pwa", () => ({ VitePWA: (options: unknown) => ({ name: "pwa-test", options }) }));

type Rule = { urlPattern: RegExp | ((input: { url: URL; request: Request; sameOrigin: boolean }) => boolean); options: { cacheName: string; expiration: unknown } };
function rule(base: string): Rule {
  vi.stubEnv("VITE_APP_BASE", base);
  const factory = config as (env: { mode: string }) => { plugins: Array<{ name?: string; options?: { workbox: { runtimeCaching: Rule[] } } }> };
  return factory({ mode: "production" }).plugins.find((plugin) => plugin.name === "pwa-test")!.options!.workbox.runtimeCaching[0];
}
function matches(policy: Rule, scope: string, path: string, headers?: Record<string, string>) {
  vi.stubGlobal("self", { registration: { scope } });
  const url = new URL(path, scope);
  const input = { url, request: new Request(url, { headers }), sameOrigin: url.origin === new URL(scope).origin };
  return policy.urlPattern instanceof RegExp ? policy.urlPattern.test(url.href) : policy.urlPattern(input);
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("运行时离线缓存边界", () => {
  it.each(["/", "/schedule/", "./"])("base %s 仅缓存本应用公开静态文件", (base) => {
    const policy = rule(base);
    const scope = `https://example.com${base === "/" ? "/" : "/schedule/"}`;
    for (const path of ["assets/index-hash.js", "assets/pdf.worker-hash.mjs", "focus/focus-bg-1.webp", "app-icon-192.png", "manifest.webmanifest"]) {
      expect(matches(policy, scope, path), path).toBe(true);
    }
    for (const path of ["api/account.json", "release.json", "release.json?ts=1", "assets/index.js?token=secret", "https://elsewhere.test/assets/index.js", "../another-app/assets/index.js", "private.png"]) {
      expect(matches(policy, scope, path), path).toBe(false);
    }
    expect(matches(policy, scope, "assets/index.js", { Authorization: "Bearer private" })).toBe(false);
    expect(policy.options.expiration).toEqual({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 });
  });

  it("根路径与子路径部署使用不同缓存名", () => {
    expect(rule("/").options.cacheName).not.toBe(rule("/schedule/").options.cacheName);
  });

  it("匹配函数序列化到Service Worker后仍可独立执行", () => {
    const policy = rule("/schedule/");
    const serialized = new Function(`return (${policy.urlPattern.toString()})`)();
    const runtime = { ...policy, urlPattern: serialized } as Rule;
    expect(matches(runtime, "https://example.com/schedule/", "assets/index-hash.js")).toBe(true);
    expect(matches(runtime, "https://example.com/schedule/", "release.json")).toBe(false);
  });
});
