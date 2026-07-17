import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("面向用户的更新说明", () => {
  it("不暴露管理后台和内部实现信息", () => {
    const releaseNotes = readFileSync(resolve(process.cwd(), "release-notes.json"), "utf8");
    const internalTerms = ["管理后台", "管理员", "service_role", "Edge Function", "数据库迁移", "密钥配置", "RLS"];
    internalTerms.forEach((term) => expect(releaseNotes).not.toContain(term));
  });
});
