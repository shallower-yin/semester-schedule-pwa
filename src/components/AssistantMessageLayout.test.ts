import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const assistantStyles = readFileSync(resolve(process.cwd(), "src/styles/05-ai-tools.css"), "utf8");

describe("助手对话消息布局", () => {
  it("普通消息不为不存在的右侧操作列预留空间", () => {
    const declaration = ruleBody(".assistant-messages p");

    expect(declaration).toContain("padding: 9px 10px");
    expect(declaration).not.toMatch(/padding(?:-right)?:[^;]*66px/);
  });

  it("AI 消息操作按钮跟随正文末尾而不是绝对定位成独立列", () => {
    const declaration = ruleBody(".assistant-inline-actions");

    expect(declaration).toContain("position: static");
    expect(declaration).toContain("display: inline-flex");
    expect(declaration).toContain("white-space: nowrap");
    expect(declaration).not.toContain("position: absolute");
    expect(declaration).not.toMatch(/\b(?:right|bottom):/);
  });
});

function ruleBody(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = assistantStyles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}
