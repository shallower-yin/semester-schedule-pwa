import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { Memo } from "../types";
import { MemoPage } from "./MemoPage";

describe("备忘录视图", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.memoFolders.clear();
    await db.memos.clear();
    await db.syncQueue.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("可以在列表和九宫格之间切换，并按九条备忘录分页", async () => {
    await db.memos.bulkAdd(Array.from({ length: 10 }, (_, index) => memoRecord(index + 1)));

    render(<MemoPage ownerId="local" />);

    await waitFor(() => expect(screen.getByText("备忘录 10")).toBeInTheDocument());

    const gridButton = screen.getByRole("button", { name: /九宫格/ });
    expect(gridButton).not.toBeDisabled();
    fireEvent.click(gridButton);

    expect(screen.getByText("九宫格 1 / 2")).toBeInTheDocument();
    const grid = screen.getByRole("list", { name: "九宫格备忘录" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(9);
    expect(within(grid).getByText("备忘录 10")).toBeInTheDocument();
    expect(within(grid).queryByText("备忘录 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一组" }));

    expect(screen.getByText("九宫格 2 / 2")).toBeInTheDocument();
    expect(within(grid).getByText("备忘录 1")).toBeInTheDocument();
    expect(within(grid).getAllByRole("button", { name: /新增备忘录/ })).toHaveLength(8);

    fireEvent.change(screen.getByPlaceholderText("搜索备忘录"), { target: { value: "10" } });

    expect(screen.getByText("九宫格 1 / 1")).toBeInTheDocument();
    expect(within(grid).getByText("备忘录 10")).toBeInTheDocument();
  });

  it("新增备忘录正文可以插入编号和待办并按回车续行", async () => {
    render(<MemoPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    const textarea = screen.getByLabelText("正文") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "编号" }));
    await waitFor(() => expect(textarea).toHaveValue("1. "));

    fireEvent.change(textarea, { target: { value: "1. 鞋垫" } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(textarea).toHaveValue("1. 鞋垫\n2. "));

    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "待办" }));
    await waitFor(() => expect(textarea).toHaveValue("○ "));

    fireEvent.change(textarea, { target: { value: "○ 防晒" } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(textarea).toHaveValue("○ 防晒\n○ "));
  });

  it("复制全文会按标题和正文复制完整备忘录", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MemoPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "训练安排" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "深蹲 3 组\n俯卧撑 3 组" } });
    fireEvent.click(screen.getByRole("button", { name: "复制全文" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("训练安排\n\n深蹲 3 组\n俯卧撑 3 组"));
  });

  it("可以直接点击正文里的待办圆圈切换完成状态", async () => {
    render(<MemoPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    const textarea = screen.getByLabelText("正文") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "○ 防晒" } });
    textarea.setSelectionRange(1, 1);
    fireEvent.click(textarea);

    await waitFor(() => expect(textarea).toHaveValue("● 防晒"));
    expect(textarea).toHaveClass("memo-textarea");
    expect(document.querySelector(".memo-textarea-visual")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("待办清单")).not.toBeInTheDocument();
  });

  it("显示未完成待办数并支持筛选含未完成待办的备忘录", async () => {
    await db.memos.bulkAdd([
      { ...memoRecord(1), title: "采购", content: "○ 鞋垫\n● 防晒" },
      { ...memoRecord(2), title: "已完成清单", content: "● 整理资料" },
      { ...memoRecord(3), title: "普通记录", content: "没有待办" }
    ]);

    render(<MemoPage ownerId="local" />);

    await waitFor(() => expect(screen.getByText(/未完成待办 1 项/)).toBeInTheDocument());
    expect(screen.getByText("采购")).toBeInTheDocument();
    expect(screen.getByText("已完成清单")).toBeInTheDocument();
    expect(screen.getByText("普通记录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /未完成待办/ }));

    expect(screen.getByText("采购")).toBeInTheDocument();
    expect(screen.queryByText("已完成清单")).not.toBeInTheDocument();
    expect(screen.queryByText("普通记录")).not.toBeInTheDocument();
  });

  it("进入备忘录时把历史软删除记录转为硬删除同步队列", async () => {
    await db.memos.bulkAdd([
      memoRecord(1),
      { ...memoRecord(2), title: "旧回收站记录", deleted_at: "2026-07-09T09:00:00.000Z" }
    ]);

    render(<MemoPage ownerId="local" />);

    await waitFor(async () => expect(await db.memos.get("memo-2")).toBeUndefined());
    const deleteQueue = await db.syncQueue.where("record_id").equals("memo-2").toArray();
    expect(deleteQueue.some((item) => item.table_name === "memos" && item.operation === "delete")).toBe(true);
    expect(screen.queryByText("历史回收站")).not.toBeInTheDocument();
  });
});

function memoRecord(index: number): Memo {
  const day = String(index).padStart(2, "0");
  return {
    ...syncFields(),
    id: `memo-${index}`,
    created_at: `2026-07-${day}T08:00:00.000Z`,
    updated_at: `2026-07-${day}T09:00:00.000Z`,
    folder_id: null,
    title: `备忘录 ${index}`,
    content: `第 ${index} 条备忘录正文`,
    is_pinned: false
  };
}
