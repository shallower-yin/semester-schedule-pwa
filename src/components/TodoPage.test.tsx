import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { TodoItem } from "../types";
import { TodoPage } from "./TodoPage";

describe("独立待办页面", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.transaction("rw", db.todos, db.syncQueue, async () => {
      await db.todos.clear();
      await db.syncQueue.clear();
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("从空态新增待办，弹窗不会自动聚焦输入框", async () => {
    render(<TodoPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: "新增第一项" }));
    const titleInput = screen.getByRole("textbox", { name: "待办内容" });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(titleInput).not.toHaveFocus();

    fireEvent.change(titleInput, { target: { value: "整理课程资料" } });
    fireEvent.click(screen.getByRole("button", { name: "选择颜色 #fff0aa" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "置顶显示" }));
    fireEvent.click(screen.getByRole("button", { name: "保存待办" }));

    await waitFor(async () => {
      const saved = await db.todos.filter((item) => item.title === "整理课程资料").first();
      expect(saved).toMatchObject({
        user_id: "local",
        color: "#fff0aa",
        is_pinned: true,
        completed_at: null
      });
      expect(saved?.sort_order).toBeGreaterThan(0);
    });
    expect(await screen.findByText("整理课程资料")).toBeInTheDocument();
  });

  it("完成后显示约三秒的撤销入口，并能恢复为未完成", async () => {
    await db.todos.add(todoRecord("todo-1", "清理 C 盘", 100));
    render(<TodoPage ownerId="local" />);

    fireEvent.click(await screen.findByRole("button", { name: "完成待办 清理 C 盘" }));

    await waitFor(async () => expect((await db.todos.get("todo-1"))?.completed_at).toBeTruthy());
    const undoToast = screen.getByRole("status");
    expect(within(undoToast).getByText(/已完成“清理 C 盘”/)).toBeInTheDocument();
    fireEvent.click(within(undoToast).getByRole("button", { name: "撤销" }));

    await waitFor(async () => expect((await db.todos.get("todo-1"))?.completed_at).toBeNull());
    expect(await screen.findByRole("button", { name: "完成待办 清理 C 盘" })).toBeInTheDocument();
  });

  it("支持搜索、折叠已完成区域和编辑卡片主体", async () => {
    await db.todos.bulkAdd([
      todoRecord("todo-1", "购买随身 WiFi", 100),
      { ...todoRecord("todo-2", "已经整理书签", 200), completed_at: "2026-09-01T02:00:00.000Z" }
    ]);
    render(<TodoPage ownerId="local" />);

    expect(await screen.findByText("购买随身 WiFi")).toBeInTheDocument();
    expect(screen.queryByText("已经整理书签")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    expect(screen.getByText("已经整理书签")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索待办" }), { target: { value: "书签" } });
    expect(screen.queryByText("购买随身 WiFi")).not.toBeInTheDocument();
    expect(screen.getByText("已经整理书签")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑待办 已经整理书签" }));
    expect(screen.getByRole("dialog", { name: "编辑待办" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "待办内容" })).toHaveValue("已经整理书签");
  });

  it("未完成清空后给出完成语义，完成历史按完成时间倒序且不显示排序操作", async () => {
    await db.todos.bulkAdd([
      { ...todoRecord("todo-1", "较早完成", 300), completed_at: "2026-09-01T01:00:00.000Z" },
      { ...todoRecord("todo-2", "刚刚完成", 100), completed_at: "2026-09-01T03:00:00.000Z" }
    ]);
    render(<TodoPage ownerId="local" />);

    expect(await screen.findByText("待办已清空")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    const completedList = screen.getByRole("list");
    expect(completedList.textContent?.indexOf("刚刚完成")).toBeLessThan(completedList.textContent?.indexOf("较早完成") ?? 0);

    fireEvent.click(screen.getByRole("button", { name: "待办“刚刚完成”操作" }));
    expect(screen.queryByRole("menuitem", { name: "上移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "下移" })).not.toBeInTheDocument();
  });

  it("更多菜单支持手动排序、置顶、复制和确认软删除", async () => {
    await db.todos.bulkAdd([
      todoRecord("todo-1", "第一项", 100),
      todoRecord("todo-2", "第二项", 200)
    ]);
    render(<TodoPage ownerId="local" />);

    const firstMenuTrigger = await screen.findByRole("button", { name: "待办“第一项”操作" });
    fireEvent.click(firstMenuTrigger);
    expect(firstMenuTrigger.closest(".todo-card")).toHaveClass("menu-open");
    fireEvent.click(screen.getByRole("menuitem", { name: "下移" }));
    expect(firstMenuTrigger.closest(".todo-card")).not.toHaveClass("menu-open");
    await waitFor(async () => {
      expect((await db.todos.get("todo-1"))?.sort_order).toBe(200);
      expect((await db.todos.get("todo-2"))?.sort_order).toBe(100);
    });

    fireEvent.click(screen.getByRole("button", { name: "待办“第一项”操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    await waitFor(async () => expect((await db.todos.get("todo-1"))?.is_pinned).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "待办“第二项”操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(await screen.findByText("第二项（副本）")).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "待办“第二项”操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    await waitFor(async () => expect((await db.todos.get("todo-2"))?.deleted_at).toBeTruthy());
    expect((await db.syncQueue.where("record_id").equals("todo-2").first())?.operation).toBe("delete");
    await waitFor(() => expect(screen.queryByText("第二项")).not.toBeInTheDocument());
  });

  it("搜索时隐藏手动排序操作并保持完整列表顺序不变", async () => {
    await db.todos.bulkAdd([
      todoRecord("todo-1", "课程资料 A", 100),
      todoRecord("todo-2", "其他事项", 200),
      todoRecord("todo-3", "课程资料 C", 300)
    ]);
    render(<TodoPage ownerId="local" />);

    await screen.findByText("课程资料 C");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索待办" }), {
      target: { value: "课程资料" }
    });
    expect(screen.queryByText("其他事项")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "待办“课程资料 C”操作" }));
    expect(screen.queryByRole("menuitem", { name: "上移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "下移" })).not.toBeInTheDocument();

    expect((await db.todos.get("todo-1"))?.sort_order).toBe(100);
    expect((await db.todos.get("todo-2"))?.sort_order).toBe(200);
    expect((await db.todos.get("todo-3"))?.sort_order).toBe(300);
  });

  it("消费热启动新增请求一次，并允许新的请求再次打开", async () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <TodoPage ownerId="local" openCreateRequest="request-1" onOpenCreateConsumed={onConsumed} />
    );

    expect(await screen.findByRole("dialog", { name: "新增待办" })).toBeInTheDocument();
    expect(onConsumed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    rerender(<TodoPage ownerId="local" openCreateRequest="request-1" onOpenCreateConsumed={onConsumed} />);
    expect(screen.queryByRole("dialog", { name: "新增待办" })).not.toBeInTheDocument();
    expect(onConsumed).toHaveBeenCalledTimes(1);

    rerender(<TodoPage ownerId="local" openCreateRequest="request-2" onOpenCreateConsumed={onConsumed} />);
    expect(await screen.findByRole("dialog", { name: "新增待办" })).toBeInTheDocument();
    expect(onConsumed).toHaveBeenCalledTimes(2);
  });

  it("账号切换时关闭旧账号草稿且不展示另一账号待办", async () => {
    await db.todos.bulkAdd([
      { ...todoRecord("alice-1", "Alice 待办", 100), user_id: "alice" },
      { ...todoRecord("bob-1", "Bob 待办", 100), user_id: "bob" }
    ]);
    const { rerender } = render(<TodoPage ownerId="alice" />);

    expect(await screen.findByText("Alice 待办")).toBeInTheDocument();
    expect(screen.queryByText("Bob 待办")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑待办 Alice 待办" }));
    fireEvent.change(screen.getByRole("textbox", { name: "待办内容" }), { target: { value: "未保存草稿" } });

    rerender(<TodoPage ownerId="bob" />);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑待办" })).not.toBeInTheDocument());
    expect(await screen.findByText("Bob 待办")).toBeInTheDocument();
    expect(screen.queryByText("Alice 待办")).not.toBeInTheDocument();
  });
});

function todoRecord(id: string, title: string, sortOrder: number): TodoItem {
  return {
    ...syncFields(undefined, "local"),
    id,
    title,
    color: "#ccecf7",
    sort_order: sortOrder,
    is_pinned: false,
    completed_at: null
  };
}
