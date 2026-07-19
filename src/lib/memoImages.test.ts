import { describe, expect, it } from "vitest";
import { MEMO_IMAGE_LIMIT, normalizeMemoImages, validateMemoImage } from "./memoImages";

describe("备忘录图片", () => {
  it("只保留结构完整的图片元数据并限制数量", () => {
    const input = [
      null,
      { name: "缺少路径.png" },
      ...Array.from({ length: MEMO_IMAGE_LIMIT + 2 }, (_, index) => ({
        id: `image-${index}`,
        name: `图片 ${index}.png`,
        path: `user-1/memo-1/image-${index}.png`,
        mime_type: "image/png",
        size: 128
      }))
    ];

    const images = normalizeMemoImages(input);
    expect(images).toHaveLength(MEMO_IMAGE_LIMIT);
    expect(images[0]).toEqual(expect.objectContaining({ id: "image-0", mime_type: "image/png" }));
  });

  it("拒绝非图片或超过 8 MB 的文件", () => {
    expect(() => validateMemoImage(new File(["text"], "notes.txt", { type: "text/plain" }))).toThrow("格式不支持");
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    expect(() => validateMemoImage(oversized)).toThrow("超过 8 MB");
  });
});
