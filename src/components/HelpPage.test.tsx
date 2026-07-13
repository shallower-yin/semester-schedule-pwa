import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("使用说明", () => {
  it("直接展示常见问题，并说明两个助手的区别", () => {
    render(<HelpPage />);

    expect(screen.getByRole("heading", { name: "AI 助手和日程助手有什么区别？" })).toBeInTheDocument();
    expect(screen.getByText(/日程助手只在本机按固定规则查询日程/)).toBeInTheDocument();
    expect(screen.getByText(/AI 助手使用云端模型理解自由表达/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "帮助" })).not.toBeInTheDocument();
    expect(screen.queryByText("最短路径")).not.toBeInTheDocument();
  });
});
