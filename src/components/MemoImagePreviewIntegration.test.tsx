import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { appHistoryLayer, initializeAppHistory } from "../lib/appHistory";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { Memo, MemoImage } from "../types";
import { MemoPage } from "./MemoPage";

const { getMemoImageUrlsMock } = vi.hoisted(() => ({
  getMemoImageUrlsMock: vi.fn()
}));

vi.mock("../lib/memoImages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/memoImages")>();
  return { ...actual, getMemoImageUrls: getMemoImageUrlsMock };
});

describe("备忘录图片查看入口", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    initializeAppHistory("memos");
    localStorage.clear();
    setCurrentUserId("alice");
    await db.memoFolders.clear();
    await db.memos.clear();
    await db.syncQueue.clear();
    getMemoImageUrlsMock.mockReset().mockImplementation(async (images: MemoImage[]) => (
      Object.fromEntries(images.map((image) => [image.path, `https://signed.example/${image.id}`]))
    ));
  });

  afterEach(() => cleanup());

  it("缩略图可由键盘聚焦，查看后返回仍保留未保存草稿", async () => {
    const image: MemoImage = {
      id: "image-1",
      name: "课堂板书.png",
      path: "alice/memo-1/image-1.png",
      mime_type: "image/png",
      size: 10
    };
    const memo: Memo = {
      ...syncFields(undefined, "alice"),
      id: "memo-1",
      folder_id: null,
      title: "原标题",
      content: "原正文",
      is_pinned: false,
      images: [image]
    };
    await db.memos.add(memo);

    render(<MemoPage ownerId="alice" openMemoId={memo.id} />);
    const title = await screen.findByRole("textbox", { name: "标题" });
    fireEvent.change(title, { target: { value: "尚未保存的新标题" } });
    const thumbnail = await screen.findByRole("button", { name: "查看图片 课堂板书.png" });
    thumbnail.focus();
    expect(thumbnail).toHaveFocus();
    await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^modal-/));
    const editorHistoryState = window.history.state;

    fireEvent.click(thumbnail);
    await screen.findByRole("dialog", { name: "查看图片：课堂板书.png" });
    await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^modal-/));
    expect(getMemoImageUrlsMock).toHaveBeenCalledTimes(2);

    window.history.replaceState(editorHistoryState, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: editorHistoryState }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "查看图片：课堂板书.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("尚未保存的新标题");
    expect((await db.memos.get(memo.id))?.title).toBe("原标题");
  });
});
