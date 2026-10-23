import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"));

describe("DOCX 依赖安全与兼容性", () => {
  it("使用包含官方 CLI 修复的不可变提交，且安装树不再含 sprintf-js", () => {
    // Return to an npm release once it includes this upstream commit, keeping the no-sprintf check.
    const source = "https://codeload.github.com/mwilliamson/mammoth.js/tar.gz/5171a9072f8b7343ab1c9ed3a15d6d372cb59b67";
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(manifest.dependencies.mammoth).toBe(source);
    expect(lock.packages["node_modules/mammoth"].resolved).toBe(source);
    expect(lock.packages["node_modules/mammoth"].integrity).toMatch(/^sha512-/);
    expect(Object.keys(lock.packages).filter((name) => /(?:^|\/)sprintf-js$/.test(name))).toEqual([]);
    const mammothPackage = require("mammoth/package.json");
    expect(mammothPackage.dependencies.argparse).toBe("^3.0.3");
  });

  it.each([
    ["single-paragraph", "Walking on imported air\n\n"],
    ["tables", "Above\n\nTop left\n\nTop right\n\nBottom left\n\nBottom right\n\nBelow\n\n"],
    ["simple-list", "Apple\n\nBanana\n\n"],
    ["text-box", "\n\nDatum plane\n\n"],
    ["strict-format", "Test\n\n"],
    ["footnotes", "Ouch.\n\n"],
    ["endnotes", "Ouch.\n\n"],
    ["utf8-bom", "This XML has a byte order mark.\n\n"]
  ])("真实上游 DOCX %s 保持原文提取兼容", async (name, expected) => {
    // Fixtures remain in the official dependency archive; no upstream parser or binary is vendored.
    const root = dirname(require.resolve("mammoth/package.json"));
    const buffer = readFileSync(resolve(root, "test/test-data", `${name}.docx`));
    const mammoth = require("mammoth") as typeof import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toBe(expected);
  });
});
