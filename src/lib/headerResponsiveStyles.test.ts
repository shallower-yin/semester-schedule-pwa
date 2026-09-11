import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coreStyles = readFileSync(resolve(process.cwd(), "src/styles/01-core-schedule.css"), "utf8");
const responsiveStyles = readFileSync(resolve(process.cwd(), "src/styles/06-responsive.css"), "utf8");

describe("顶部导航响应式布局", () => {
  it("在常见桌面缩放后的有效宽度内继续使用双行布局", () => {
    expect(responsiveStyles).toMatch(
      /@media\s*\(min-width:\s*901px\)\s*and\s*\(max-width:\s*1919\.98px\)\s*\{[\s\S]*?\.app-header\s*\{[\s\S]*?"navigation navigation"/
    );
  });

  it("账号同步文字始终保持单行并在空间不足时省略", () => {
    expect(coreStyles).toMatch(/\.sync-status\s*\{[^}]*max-width:\s*260px/);
    expect(coreStyles).toMatch(
      /\.sync-status span\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap[^}]*\}/
    );
  });
});
