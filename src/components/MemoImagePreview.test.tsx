import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appHistoryLayer, initializeAppHistory } from "../lib/appHistory";
import type { MemoImage } from "../types";
import { MemoImagePreview } from "./MemoImagePreview";

const { getMemoImageUrlsMock } = vi.hoisted(() => ({
  getMemoImageUrlsMock: vi.fn()
}));

vi.mock("../lib/memoImages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/memoImages")>();
  return { ...actual, getMemoImageUrls: getMemoImageUrlsMock };
});

const images: MemoImage[] = [
  { id: "one", name: "课堂板书.png", path: "user/memo/one.png", mime_type: "image/png", size: 10 },
  { id: "two", name: "实验装置.jpg", path: "user/memo/two.jpg", mime_type: "image/jpeg", size: 20 }
];

describe("备忘录图片查看器", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    initializeAppHistory("memos");
    getMemoImageUrlsMock.mockReset();
  });

  afterEach(() => cleanup());

  it("打开和切换图片时重新取得私有地址，并支持缩放与滚轮复位", async () => {
    let request = 0;
    getMemoImageUrlsMock.mockImplementation(async (requested: MemoImage[]) => {
      request += 1;
      return { [requested[0].path]: `https://signed.example/${requested[0].id}?request=${request}` };
    });

    render(<MemoImagePreview images={images} initialIndex={0} onClose={() => undefined} />);

    const firstImage = await screen.findByRole("img", { name: "课堂板书.png" });
    expect(firstImage).toHaveAttribute("src", "https://signed.example/one?request=1");
    fireEvent.load(firstImage);

    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByRole("button", { name: "重置图片缩放" })).toHaveTextContent("125%");
    fireEvent.wheel(screen.getByRole("region", { name: "图片预览 课堂板书.png" }), { deltaY: -100 });
    expect(screen.getByRole("button", { name: "重置图片缩放" })).toHaveTextContent("150%");
    fireEvent.click(screen.getByRole("button", { name: "重置图片缩放" }));
    expect(screen.getByRole("button", { name: "重置图片缩放" })).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "下一张图片" }));
    const secondImage = await screen.findByRole("img", { name: "实验装置.jpg" });
    expect(secondImage).toHaveAttribute("src", "https://signed.example/two?request=2");
    expect(getMemoImageUrlsMock).toHaveBeenLastCalledWith([images[1]]);
  });

  it("图片地址或内容加载失败时给出持续错误并可重新加载", async () => {
    getMemoImageUrlsMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ [images[0].path]: "https://signed.example/retry" });

    render(<MemoImagePreview images={images.slice(0, 1)} initialIndex={0} onClose={() => undefined} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法取得这张图片的访问地址");
    expect(screen.getByRole("button", { name: "放大图片" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    const image = await screen.findByRole("img", { name: "课堂板书.png" });
    fireEvent.error(image);
    expect(await screen.findByRole("alert")).toHaveTextContent("图片内容加载失败");
    expect(getMemoImageUrlsMock).toHaveBeenCalledTimes(2);
  });

  it("放大窄图时按图片实际尺寸限制拖动范围", async () => {
    getMemoImageUrlsMock.mockResolvedValue({ [images[0].path]: "https://signed.example/one" });
    render(<MemoImagePreview images={images.slice(0, 1)} initialIndex={0} onClose={() => undefined} />);

    const image = await screen.findByRole("img", { name: "课堂板书.png" });
    const viewport = screen.getByRole("region", { name: "图片预览 课堂板书.png" });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 }
    });
    Object.defineProperties(image, {
      clientWidth: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 300 }
    });
    fireEvent.load(image);
    for (let index = 0; index < 4; index++) {
      fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    }

    fireEvent(viewport, pointerEvent("pointerdown", 1, 0, 0));
    fireEvent(viewport, pointerEvent("pointermove", 1, 1000, 1000));
    fireEvent(viewport, pointerEvent("pointerup", 1, 1000, 1000));

    expect(image).toHaveStyle({ transform: "translate(0px, 150px) scale(2)" });
  });

  it("系统返回只关闭顶层图片查看器", async () => {
    const onClose = vi.fn();
    getMemoImageUrlsMock.mockResolvedValue({ [images[0].path]: "https://signed.example/one" });
    render(<MemoImagePreview images={images} initialIndex={0} onClose={onClose} />);
    await waitFor(() => expect(appHistoryLayer(window.history.state)).toMatch(/^modal-/));

    window.history.replaceState({ __semesterSchedule: { page: "memos" } }, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}
