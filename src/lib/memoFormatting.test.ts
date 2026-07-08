import { describe, expect, it } from "vitest";
import { applyMemoLineFormat, continueMemoListOnEnter, getMemoChecklistStats, toggleMemoChecklistAtCursor } from "./memoFormatting";

describe("备忘录正文格式化", () => {
  it("在空正文中插入首个编号", () => {
    const edit = applyMemoLineFormat("", 0, 0, "numbered");

    expect(edit.content).toBe("1. ");
    expect(edit.cursor).toBe(3);
  });

  it("编号行按回车后自动续下一个编号", () => {
    const content = "1. 鞋垫";
    const edit = continueMemoListOnEnter(content, content.length, content.length);

    expect(edit).toEqual({
      content: "1. 鞋垫\n2. ",
      cursor: "1. 鞋垫\n2. ".length
    });
  });

  it("空编号行按回车后退出编号", () => {
    const content = "1. 鞋垫\n2. ";
    const edit = continueMemoListOnEnter(content, content.length, content.length);

    expect(edit).toEqual({
      content: "1. 鞋垫\n",
      cursor: "1. 鞋垫\n".length
    });
  });

  it("在空正文中插入首个待办圆圈", () => {
    const edit = applyMemoLineFormat("", 0, 0, "checklist");

    expect(edit.content).toBe("○ ");
    expect(edit.cursor).toBe(2);
  });

  it("待办行按回车后自动续下一个圆圈", () => {
    const content = "○ 鞋垫";
    const edit = continueMemoListOnEnter(content, content.length, content.length);

    expect(edit).toEqual({
      content: "○ 鞋垫\n○ ",
      cursor: "○ 鞋垫\n○ ".length
    });
  });

  it("点击圆圈待办标记时切换完成状态", () => {
    expect(toggleMemoChecklistAtCursor("○ 鞋垫", 1)?.content).toBe("● 鞋垫");
    expect(toggleMemoChecklistAtCursor("● 鞋垫", 1)?.content).toBe("○ 鞋垫");
  });

  it("点击 Markdown 待办标记时切换完成状态", () => {
    expect(toggleMemoChecklistAtCursor("- [ ] 鞋垫", 4)?.content).toBe("- [x] 鞋垫");
    expect(toggleMemoChecklistAtCursor("- [x] 鞋垫", 4)?.content).toBe("- [ ] 鞋垫");
  });

  it("点击待办正文文字时不切换状态", () => {
    expect(toggleMemoChecklistAtCursor("○ 鞋垫", "○ 鞋".length)).toBeNull();
  });

  it("统计备忘录中的未完成待办", () => {
    expect(getMemoChecklistStats("○ 鞋垫\n● 防晒\n- [ ] 买纸巾\n- [x] 整理书包")).toEqual({
      total: 4,
      completed: 2,
      incomplete: 2
    });
  });
});
