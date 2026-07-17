import { describe, expect, it } from "vitest";
import { buildMindMapLayout, mindMapNeedsScheduleContext, mindMapToSvg, splitMindMapLabel, type AiMindMapNode } from "./mindMap";

const map: AiMindMapNode = {
  label: "项目计划",
  children: [
    { label: "需求分析", children: [{ label: "用户访谈", children: [] }, { label: "功能清单", children: [] }] },
    { label: "实施", children: [{ label: "开发", children: [] }, { label: "测试", children: [] }] }
  ]
};

describe("思维导图布局", () => {
  it("为所有节点生成不重叠的树形位置和连线", () => {
    const layout = buildMindMapLayout(map);
    expect(layout.nodes).toHaveLength(7);
    expect(layout.edges).toHaveLength(6);
    const root = layout.nodes.find((node) => node.side === 0)!;
    expect(layout.nodes.some((node) => node.side === -1 && node.x < root.x)).toBe(true);
    expect(layout.nodes.some((node) => node.side === 1 && node.x > root.x)).toBe(true);
    expect(new Set(layout.nodes.map((node) => `${node.side}:${node.x}:${node.y}`)).size).toBe(layout.nodes.length);
    expect(layout.width).toBeGreaterThan(700);
  });

  it("长标题分行并可导出完整 SVG", () => {
    expect(splitMindMapLabel("这是一个用于验证自动换行的超长思维导图节点标题").length).toBeGreaterThan(1);
    const svg = mindMapToSvg(map);
    expect(svg).toContain("<svg");
    expect(svg).toContain("项目计划");
    expect(svg).toContain("<path");
  });

  it("只有明确询问日程时才读取用户日程上下文", () => {
    expect(mindMapNeedsScheduleContext("总结内容")).toBe(false);
    expect(mindMapNeedsScheduleContext("总结附件知识点")).toBe(false);
    expect(mindMapNeedsScheduleContext("整理项目方案")).toBe(false);
    expect(mindMapNeedsScheduleContext("梳理本周学习计划")).toBe(true);
    expect(mindMapNeedsScheduleContext("总结明天的课程和待办")).toBe(true);
  });
});
