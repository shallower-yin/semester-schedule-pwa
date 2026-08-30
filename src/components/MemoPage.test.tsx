import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { db } from "../db";
import { setCurrentUserId, syncFields } from "../lib/identity";
import { findSearchNavigationMatch } from "../lib/searchNavigation";
import type { Memo } from "../types";
import { MemoPage } from "./MemoPage";

const { getMemoImageUrlsMock, removeMemoImagesMock, uploadMemoImageMock } = vi.hoisted(() => ({
  getMemoImageUrlsMock: vi.fn(),
  removeMemoImagesMock: vi.fn(),
  uploadMemoImageMock: vi.fn()
}));

vi.mock("../lib/memoImages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/memoImages")>();
  return {
    ...actual,
    getMemoImageUrls: getMemoImageUrlsMock,
    removeMemoImages: removeMemoImagesMock,
    uploadMemoImage: uploadMemoImageMock
  };
});

describe("备忘录视图", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.memoFolders.clear();
    await db.memos.clear();
    await db.syncQueue.clear();
    getMemoImageUrlsMock.mockReset().mockResolvedValue({});
    removeMemoImagesMock.mockReset().mockResolvedValue(undefined);
    uploadMemoImageMock.mockReset().mockResolvedValue({
      id: "image-1",
      name: "课堂板书.png",
      path: "user-1/memo-draft/image-1.png",
      mime_type: "image/png",
      size: 3
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("跨标签切换共享身份后，新建备忘录仍归属打开弹窗的账号", async () => {
    setCurrentUserId("alice");
    render(<MemoPage ownerId="alice" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Alice 的备忘" } });
    setCurrentUserId("bob");
    fireEvent.click(screen.getByRole("button", { name: "保存备忘录" }));

    await waitFor(async () => {
      const saved = await db.memos.filter((item) => item.title === "Alice 的备忘").first();
      expect(saved?.user_id).toBe("alice");
    });
  });

  it("登录用户可以插入图片并把私有路径随备忘录保存", async () => {
    setCurrentUserId("user-1");
    render(<MemoPage ownerId="user-1" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "实验记录" } });
    const file = new File(["png"], "课堂板书.png", { type: "image/png" });
    const fileInput = document.querySelector('input[aria-label="从电脑选择文件"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadMemoImageMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", file })));
    expect(await screen.findByText("课堂板书.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存备忘录" }));

    await waitFor(async () => {
      const saved = await db.memos.filter((item) => item.title === "实验记录").first();
      expect(saved?.images).toEqual([expect.objectContaining({ path: "user-1/memo-draft/image-1.png" })]);
    });
    expect((await db.syncQueue.toArray()).some((item) => item.table_name === "memos" && item.operation === "upsert")).toBe(true);
  });

  it("数据库写入未完成时卸载编辑器不会删除即将被备忘录引用的新图片", async () => {
    setCurrentUserId("alice");
    const memoTable = db.table<Memo, string>("memos");
    const tablePrototype = Object.getPrototypeOf(memoTable) as { put: typeof memoTable.put };
    const originalPut = memoTable.put.bind(memoTable);
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const putSpy = vi.spyOn(tablePrototype, "put").mockImplementationOnce((record) => (
      Dexie.Promise.resolve(Dexie.waitFor(putGate)).then(() => originalPut(record))
    ));
    const { unmount } = render(<MemoPage ownerId="alice" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "延迟保存" } });
    const file = new File(["png"], "课堂板书.png", { type: "image/png" });
    const fileInput = document.querySelector('input[aria-label="从电脑选择文件"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText("课堂板书.png");

    fireEvent.click(screen.getByRole("button", { name: "保存备忘录" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    unmount();

    expect(removeMemoImagesMock).not.toHaveBeenCalled();
    releasePut();

    await waitFor(async () => {
      const saved = await db.memos.filter((item) => item.title === "延迟保存").first();
      expect(saved?.images).toEqual([expect.objectContaining({ path: "user-1/memo-draft/image-1.png" })]);
    });
    expect(removeMemoImagesMock).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it("切换账号后延迟写入失败会清理未被任何备忘录引用的新图片", async () => {
    setCurrentUserId("alice");
    const memoTable = db.table<Memo, string>("memos");
    const tablePrototype = Object.getPrototypeOf(memoTable) as { put: typeof memoTable.put };
    let rejectPut!: (error: Error) => void;
    const putGate = new Promise<never>((_resolve, reject) => {
      rejectPut = reject;
    });
    const putSpy = vi.spyOn(tablePrototype, "put").mockImplementationOnce(() => (
      Dexie.Promise.resolve(Dexie.waitFor(putGate))
    ));
    const { rerender } = render(<MemoPage ownerId="alice" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "不会保存" } });
    const file = new File(["png"], "课堂板书.png", { type: "image/png" });
    const fileInput = document.querySelector('input[aria-label="从电脑选择文件"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText("课堂板书.png");

    fireEvent.click(screen.getByRole("button", { name: "保存备忘录" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    rerender(<MemoPage ownerId="bob" />);

    expect(removeMemoImagesMock).not.toHaveBeenCalled();
    rejectPut(new Error("模拟数据库写入失败"));

    await waitFor(() => expect(removeMemoImagesMock).toHaveBeenCalledWith(["user-1/memo-draft/image-1.png"]));
    expect(await db.memos.filter((item) => item.title === "不会保存").count()).toBe(0);
    putSpy.mockRestore();
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

  it("桌面双击正文文字选中整行，触摸操作保留原生选区", () => {
    render(<MemoPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增备忘录/ }));
    const textarea = screen.getByLabelText("正文") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "第一行\n第二行文字\n第三行" } });

    textarea.setSelectionRange(6, 8);
    fireEvent.pointerDown(textarea, { pointerType: "mouse" });
    fireEvent.doubleClick(textarea, { detail: 2 });
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(9);

    textarea.setSelectionRange(12, 13);
    const touchPointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(touchPointerDown, "pointerType", { value: "touch" });
    fireEvent(textarea, touchPointerDown);
    fireEvent.doubleClick(textarea, { detail: 2 });
    expect(textarea.selectionStart).toBe(12);
    expect(textarea.selectionEnd).toBe(13);
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

  it("从搜索打开备忘录时定位具体行并显示主题色底纹", async () => {
    const memo = { ...memoRecord(1), content: "第一行\n复习高等数学第三章\n最后一行" };
    await db.memos.add(memo);

    render(
      <MemoPage
        ownerId="local"
        openMemoId={memo.id}
        openSearchMatch={{
          query: "高等数学",
          field: "content",
          fieldLabel: "正文",
          start: 6,
          end: 10,
          line: 1,
          lineStart: 4,
          lineEnd: 13,
          preview: "复习高等数学第三章"
        }}
      />
    );

    const textarea = await screen.findByLabelText("正文") as HTMLTextAreaElement;
    await waitFor(() => expect(screen.getByText("已定位到第 2 行")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("memo-search-line-highlight")).toHaveClass("memo-search-line-highlight"));
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(10);

    const editedContent = `${memo.content}\n补充内容`;
    fireEvent.change(textarea, { target: { value: editedContent } });
    textarea.setSelectionRange(editedContent.length, editedContent.length);
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(screen.queryByText("已定位到第 2 行")).not.toBeInTheDocument();
    expect(textarea.selectionStart).toBe(editedContent.length);
    expect(textarea.selectionEnd).toBe(editedContent.length);
  });

  it("通过正文工具栏编辑后立即撤销搜索行定位", async () => {
    const memo = { ...memoRecord(1), content: "第一行\n复习高等数学第三章\n最后一行" };
    await db.memos.add(memo);

    render(
      <MemoPage
        ownerId="local"
        openMemoId={memo.id}
        openSearchMatch={{
          query: "高等数学",
          field: "content",
          fieldLabel: "正文",
          start: 6,
          end: 10,
          line: 1,
          lineStart: 4,
          lineEnd: 13,
          preview: "复习高等数学第三章"
        }}
      />
    );

    await waitFor(() => expect(screen.getByText("已定位到第 2 行")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编号" }));

    expect(screen.queryByText("已定位到第 2 行")).not.toBeInTheDocument();
    expect(screen.queryByTestId("memo-search-line-highlight")).not.toBeInTheDocument();
  });

  it("CRLF 正文从搜索打开时仍选中第二行的准确关键词", async () => {
    const memo = { ...memoRecord(1), content: "第一行\r\n复习高数" };
    const match = findSearchNavigationMatch([
      { field: "content", label: "正文", value: memo.content }
    ], "复习");
    await db.memos.add(memo);

    render(<MemoPage ownerId="local" openMemoId={memo.id} openSearchMatch={match} />);

    const textarea = await screen.findByLabelText("正文") as HTMLTextAreaElement;
    await waitFor(() => expect(screen.getByText("已定位到第 2 行")).toBeInTheDocument());
    expect(textarea.value).toBe("第一行\n复习高数");
    await waitFor(() => expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("复习"));
  });

  it("父级消费打开请求时仍保留定位匹配直到弹窗关闭", async () => {
    const memo = { ...memoRecord(1), content: "第一行\n复习高等数学第三章\n最后一行" };
    await db.memos.add(memo);
    const match = {
      query: "高等数学",
      field: "content",
      fieldLabel: "正文",
      start: 6,
      end: 10,
      line: 1,
      lineStart: 4,
      lineEnd: 13,
      preview: "复习高等数学第三章"
    };

    function Harness() {
      const [openId, setOpenId] = useState<string | null>(memo.id);
      const [openMatch, setOpenMatch] = useState<typeof match | null>(match);
      return (
        <MemoPage
          ownerId="local"
          openMemoId={openId}
          openSearchMatch={openMatch}
          onOpenMemoConsumed={() => {
            setOpenId(null);
            // Simulate a parent clearing one-shot deep-link props.
            setOpenMatch(null);
          }}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByText("已定位到第 2 行")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("memo-search-line-highlight")).toBeInTheDocument());
  });

  it("搜索切换到另一条备忘录时重新挂载编辑器，不会把旧草稿写到新记录", async () => {
    const first = { ...memoRecord(1), title: "第一条" };
    const second = { ...memoRecord(2), title: "第二条" };
    await db.memos.bulkAdd([first, second]);

    const { rerender } = render(<MemoPage ownerId="local" openMemoId={first.id} />);
    const titleInput = await screen.findByRole("textbox", { name: "标题" });
    await waitFor(() => expect(titleInput).toHaveValue("第一条"));
    fireEvent.change(titleInput, { target: { value: "第一条的未保存草稿" } });

    rerender(<MemoPage ownerId="local" openMemoId={second.id} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("第二条"));
  });

  it("切换账号时立即关闭旧账号正在编辑的备忘录", async () => {
    const aliceMemo = { ...memoRecord(1), user_id: "alice", title: "Alice 私人记录" };
    await db.memos.add(aliceMemo);

    const { rerender } = render(<MemoPage ownerId="alice" openMemoId={aliceMemo.id} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("Alice 私人记录"));

    rerender(<MemoPage ownerId="bob" openMemoId={aliceMemo.id} />);

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument());
  });
});

function memoRecord(index: number): Memo {
  const day = String(index).padStart(2, "0");
  return {
    ...syncFields(undefined, "local"),
    id: `memo-${index}`,
    created_at: `2026-07-${day}T08:00:00.000Z`,
    updated_at: `2026-07-${day}T09:00:00.000Z`,
    folder_id: null,
    title: `备忘录 ${index}`,
    content: `第 ${index} 条备忘录正文`,
    is_pinned: false
  };
}
