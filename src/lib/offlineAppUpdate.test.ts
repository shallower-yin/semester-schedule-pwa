import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRelease } from "./appRelease";
import { installOfflineAppUpdate } from "./offlineAppUpdate";

class MemoryCache {
  private entries = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(toUrl(request), response.clone());
  }

  async match(request: RequestInfo | URL) {
    return this.entries.get(toUrl(request))?.clone();
  }

  async keys() {
    return Array.from(this.entries.keys(), (url) => new Request(url));
  }

  async delete(request: RequestInfo | URL) {
    return this.entries.delete(toUrl(request));
  }
}

class MemoryCacheStorage {
  private stores = new Map<string, MemoryCache>();

  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name)!;
  }

  async keys() {
    return Array.from(this.stores.keys());
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }
}

const release: AppRelease = {
  version: "2026.07.18.3",
  commit: "abc1234",
  title: "更新",
  notes: ["测试更新"],
  publishedAt: "",
  appUrl: window.location.href
};

describe("免代理应用更新", () => {
  beforeEach(async () => {
    const cacheStorage = new MemoryCacheStorage();
    Object.defineProperty(window, "caches", { configurable: true, value: cacheStorage });
    Object.defineProperty(globalThis, "caches", { configurable: true, value: cacheStorage });
    const precache = await cacheStorage.open("workbox-precache-v2-test");
    await precache.put(new Request(new URL("index.html?__WB_REVISION__=old", document.baseURI)), new Response("old"));
  });

  it("全部资源下载成功后才替换入口并写入运行时缓存", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("asset-manifest.json")) {
        return Response.json({
          version: release.version,
          commit: release.commit,
          files: ["index.html", "assets/app.js", "assets/app.css"]
        });
      }
      if (url.includes("index.html")) return new Response("<html>new</html>", { headers: { "content-type": "text/plain" } });
      if (url.includes("app.js")) return new Response("window.updated=true");
      if (url.includes("app.css")) return new Response("body{color:black}");
      return new Response("missing", { status: 404 });
    });

    await expect(installOfflineAppUpdate(release)).resolves.toBe(3);

    const precache = await caches.open("workbox-precache-v2-test");
    const indexRequest = (await precache.keys())[0];
    expect(await (await precache.match(indexRequest))?.text()).toContain("new");
    expect((await precache.match(indexRequest))?.headers.get("content-type")).toContain("text/html");

    const runtime = await caches.open("semester-schedule-offline-updates");
    expect(await (await runtime.match(new URL("assets/app.js", document.baseURI)))?.text()).toContain("updated");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

function toUrl(request: RequestInfo | URL): string {
  if (request instanceof Request) return request.url;
  return new URL(String(request), document.baseURI).href;
}
