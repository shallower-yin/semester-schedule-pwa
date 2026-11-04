import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const resolverRequire = createRequire(require.resolve("@rollup/plugin-node-resolve"));
const merge = resolverRequire("deepmerge");
const lock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"));

describe("PWA构建依赖安全与兼容", () => {
  it("实际resolver加载有来源说明的本地修补版，而非仅改变审计版本", () => {
    const loaded = resolverRequire("deepmerge/package.json");
    expect(loaded.name).toBe("deepmerge");
    expect(loaded.version).toBe("4.3.1-security.1");
    expect(loaded.upstream.package).toBe("deepmerge@4.3.1");
    expect(loaded.upstream.patchCommit).toBe("9add7d91abb595703679faf7b7942bbe7f87642b");
    expect(resolverRequire.resolve("deepmerge").replaceAll("\\", "/")).toContain("/vendor/deepmerge-safe/");
    expect(lock.packages["node_modules/deepmerge"].link).toBe(true);
  });

  it.each(["source", "target", "nested", "array", "all", "clone:false"])("阻止%s路径的返回对象原型污染", (path) => {
    const attack = JSON.parse('{"__proto__":{"injected":true},"keep":1}');
    let result: Record<string, unknown>;
    switch (path) {
      case "source": result = merge(Object.create(null), attack); break;
      case "target": result = merge(attack, {}); break;
      case "nested": result = merge({ child: null }, { child: attack }).child; break;
      case "array": result = merge([], [attack])[0]; break;
      case "all": result = merge.all([attack, { value: 2 }]); break;
      default: result = merge(attack, {}, { clone: false });
    }
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.injected).toBeUndefined();
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result.keep).toBe(1);
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
  });

  it("原型字段getter在读取前就被过滤，正常symbol/constructor/prototype语义保留", () => {
    let getterCalls = 0;
    const attack = Object.create(null);
    Object.defineProperty(attack, "__proto__", { enumerable: true, get() { getterCalls++; return { injected: true }; } });
    expect(merge(attack, {}).injected).toBeUndefined();
    expect(merge(Object.create(null), attack).injected).toBeUndefined();
    expect(getterCalls).toBe(0);
    const symbol = Symbol("config");
    const left = { nested: { keep: 1 }, array: [1, 2], [symbol]: { left: true }, constructor: "owned", prototype: "ordinary" };
    const right = { nested: { add: 2 }, array: [3], [symbol]: { right: true } };
    const result = merge(left, right);
    expect(result).toEqual({ nested: { keep: 1, add: 2 }, array: [1, 2, 3], [symbol]: { left: true, right: true }, constructor: "owned", prototype: "ordinary" });
    expect(left.array).toEqual([1, 2]);
    expect(merge({ values: [1] }, { values: [2] }, { arrayMerge: (_a: unknown[], b: unknown[]) => b })).toEqual({ values: [2] });
  });

  it("序列化函数末尾script标记被转义，结果仍可执行还原", () => {
    const serialize = require("serialize-javascript");
    const value = { callback: function () { return "</script><script>unsafe</script>"; } };
    const output: string = serialize(value);
    expect(output).not.toMatch(/<\/script/i);
    const restored = runInNewContext(`(${output})`);
    expect(restored.callback()).toBe("</script><script>unsafe</script>");
  });

  it("EJS升级后仍编译实际Workbox OMT loader，不引入jake旧依赖链", () => {
    const omtPath = require.resolve("@trickfilm400/rollup-plugin-off-main-thread");
    const omtRequire = createRequire(omtPath);
    const ejs = omtRequire("ejs");
    const loader = readFileSync(resolve(dirname(omtPath), "loader.ejs"), "utf8");
    const rendered = ejs.render(loader, { useEval: false, amdFunctionName: "define" });
    expect(rendered).toContain("define");
    expect(rendered).not.toContain("<%");
    expect(() => omtRequire(omtPath)()).not.toThrow();
    expect(Object.keys(lock.packages).filter((path) => /(?:^|\/)(jake|filelist)$/.test(path))).toEqual([]);
  });

  it("glob与minimatch保留构建使用的API和匹配能力", async () => {
    const { glob, globSync } = require("glob");
    const { minimatch, match } = require("minimatch");
    const paths: string[] = globSync("src/lib/buildDependencySecurity.test.ts", { cwd: process.cwd() });
    expect(paths.map((path) => path.replaceAll("\\", "/"))).toEqual(["src/lib/buildDependencySecurity.test.ts"]);
    expect(minimatch("assets/app.js", "**/*.{js,css}")).toBe(true);
    expect(match(["app.js", "secret.txt"], "*.js")).toEqual(["app.js"]);
    const signal = AbortSignal.abort();
    await expect(glob("**/*", { cwd: process.cwd(), signal })).rejects.toThrow();
  });
});
