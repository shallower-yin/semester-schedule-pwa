import { describe, expect, it } from "vitest";
import { findSearchNavigationMatch, searchMatchFieldClass } from "./searchNavigation";

describe("全局搜索定位", () => {
  it("返回命中字段、字符范围和备忘录具体行", () => {
    const content = "第一行\n复习高等数学第三章\n最后一行";
    const match = findSearchNavigationMatch([
      { field: "title", label: "标题", value: "期末计划" },
      { field: "content", label: "正文", value: content }
    ], "高等数学");

    expect(match).toMatchObject({
      field: "content",
      fieldLabel: "正文",
      line: 1,
      lineStart: 4,
      lineEnd: 13,
      preview: "复习高等数学第三章"
    });
    expect(content.slice(match!.start, match!.end)).toBe("高等数学");
  });

  it("忽略大小写并只给命中字段添加主题高亮类", () => {
    const match = findSearchNavigationMatch([
      { field: "note", label: "备注", value: "Bring Laptop" }
    ], "laptop");

    expect(match?.field).toBe("note");
    expect(searchMatchFieldClass(match, "note")).toBe("search-match-field");
    expect(searchMatchFieldClass(match, "title")).toBe("");
  });

  it("大小写折叠扩长时仍返回原文字串的正确偏移", () => {
    const value = "İABC";
    const match = findSearchNavigationMatch([
      { field: "content", label: "正文", value }
    ], "abc");

    expect(match).toMatchObject({ start: 1, end: 4 });
    expect(value.slice(match!.start, match!.end)).toBe("ABC");
    expect(findSearchNavigationMatch([
      { field: "content", label: "正文", value: "ΟΣ" }
    ], "ος")).toMatchObject({ start: 0, end: 2 });
  });

  it("把搜索内容里的正则符号按普通文字匹配", () => {
    const match = findSearchNavigationMatch([
      { field: "content", label: "正文", value: "复习 C++（第二章）" }
    ], "C++");

    expect(match).toMatchObject({ start: 3, end: 6 });
  });

  it("按 textarea 的 LF 值计算 CRLF 正文偏移", () => {
    const match = findSearchNavigationMatch([
      { field: "content", label: "正文", value: "第一行\r\n复习高数" }
    ], "复习");

    expect(match).toMatchObject({ start: 4, end: 6, line: 1, lineStart: 4 });
    expect("第一行\n复习高数".slice(match!.start, match!.end)).toBe("复习");
  });
});
