import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const todayStyles = readFileSync(resolve(process.cwd(), "src/styles/03-health-today-habits.css"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("今天页超宽网页布局", () => {
  it("只在 1440px 以上的网页端把事项列表分成两列", () => {
    expect(appSource).toContain("data-app-target={__APP_TARGET__}");
    expect(todayStyles).toMatch(
      /@media \(min-width: 1440px\)[\s\S]*?\.app-shell\[data-app-target="web"\] \.today-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    );
  });

  it("窄卡片保留操作按钮并用省略号截断过长事项文字", () => {
    expect(ruleBody(".today-item-main strong,\n.today-item-main span")).toContain("text-overflow: ellipsis");
    expect(ruleBody('.app-shell[data-app-target="web"] .today-item-actions')).toContain("flex-wrap: nowrap");
    expect(ruleBody('.app-shell[data-app-target="web"] .today-item-actions .button')).toContain("white-space: nowrap");
  });
});

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = todayStyles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}
