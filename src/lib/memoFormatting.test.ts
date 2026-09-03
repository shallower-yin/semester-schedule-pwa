import { describe, expect, it } from "vitest";
import {
  applyMemoLineFormat,
  continueMemoListOnEnter,
  getMemoChecklistMarkerRanges,
  getMemoChecklistStats,
  memoLineSelectionRange,
  toggleMemoChecklistAtCursor
} from "./memoFormatting";

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

  it("只有规范化到圆点末端的位置才能切换圆点待办", () => {
    const content = "  ○ 鞋垫";

    expect(toggleMemoChecklistAtCursor(content, 0)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 1)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 2)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 3)?.content).toBe("  ● 鞋垫");
    expect(toggleMemoChecklistAtCursor(content, 4)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 5)).toBeNull();
  });

  it("只有规范化到 Markdown 状态位末端的位置才能切换待办", () => {
    const content = "  - [ ] 鞋垫";

    expect(toggleMemoChecklistAtCursor(content, 0)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 4)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 5)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 6)?.content).toBe("  - [x] 鞋垫");
    expect(toggleMemoChecklistAtCursor(content, 7)).toBeNull();
    expect(toggleMemoChecklistAtCursor(content, 8)).toBeNull();
  });

  it("返回正文中待办标记的精确范围和规范切换位置", () => {
    const content = "  ○ 第一项\r\n普通文本\n\t●第二项\n- [ ] 第三项\n  * [X] 第四项";

    expect(getMemoChecklistMarkerRanges(content)).toEqual([
      { start: 2, end: 3, cursor: 3 },
      { start: 15, end: 16, cursor: 16 },
      { start: 22, end: 25, cursor: 24 },
      { start: 34, end: 37, cursor: 36 }
    ]);
  });

  it("统计备忘录中的未完成待办", () => {
    expect(getMemoChecklistStats("○ 鞋垫\n● 防晒\n- [ ] 买纸巾\n- [x] 整理书包")).toEqual({
      total: 4,
      completed: 2,
      incomplete: 2
    });
  });

  it("根据原生文字选区扩展为当前整行且不包含换行符", () => {
    const content = "第一行\n第二行文字\n第三行";

    expect(memoLineSelectionRange(content, 6, 8)).toEqual({ start: 4, end: 9 });
    expect(memoLineSelectionRange(content, 0)).toEqual({ start: 0, end: 3 });
    expect(memoLineSelectionRange(content, content.length)).toEqual({ start: 10, end: content.length });
  });

  it("双击选区以 selectionStart 所在行作为唯一锚点", () => {
    const content = "○ 第一行\n2. 第二行\n第三行";

    expect(memoLineSelectionRange(content, 2, 7)).toEqual({ start: 0, end: 5 });
    expect(memoLineSelectionRange(content, 8, content.length)).toEqual({ start: 6, end: 12 });
  });

  it("selectionEnd 位于下一行开头时不会把下一行选中", () => {
    const content = "第一行\n第二行\n第三行";

    expect(memoLineSelectionRange(content, 0, 4)).toEqual({ start: 0, end: 3 });
    expect(memoLineSelectionRange(content, 4, 8)).toEqual({ start: 4, end: 7 });
  });

  it("统计没有空格和带缩进的子待办", () => {
    expect(getMemoChecklistStats("○第一项\n  ○ 第二项\n●第三项\n- [ ]第四项")).toEqual({
      total: 4,
      completed: 1,
      incomplete: 3
    });
  });
});
