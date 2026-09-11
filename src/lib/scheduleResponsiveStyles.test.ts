import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const responsiveStyles = readFileSync(resolve(process.cwd(), "src/styles/06-responsive.css"), "utf8");

describe("日程工具栏响应式布局", () => {
  it("窄屏把周导航与管理操作重排为两行，避免批量事项被横向截断", () => {
    expect(responsiveStyles).toMatch(
      /@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.calendar-toolbar > \.toolbar-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)[^}]*overflow-x:\s*visible/
    );
    expect(responsiveStyles).toMatch(
      /\.calendar-toolbar > \.toolbar-actions \.button:nth-child\(2\)\s*\{[^}]*grid-column:\s*span 4/
    );
    expect(responsiveStyles).toMatch(
      /\.calendar-toolbar > \.toolbar-actions \.button:nth-child\(4\),\s*\.calendar-toolbar > \.toolbar-actions \.button:nth-child\(5\)\s*\{[^}]*grid-column:\s*span 3/
    );
  });
});
