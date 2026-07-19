import { describe, expect, it } from "vitest";
import { extractClipboardFiles } from "./clipboardFiles";

describe("extractClipboardFiles", () => {
  it("读取剪贴板中的文件项目", () => {
    const screenshot = new File(["image"], "截图.png", { type: "image/png" });
    const clipboardData = {
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => screenshot }
      ],
      files: []
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(extractClipboardFiles(clipboardData)).toEqual([screenshot]);
  });

  it("浏览器只提供 files 时仍可读取附件", () => {
    const document = new File(["notes"], "讲义.txt", { type: "text/plain" });
    const clipboardData = {
      items: [],
      files: [document]
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(extractClipboardFiles(clipboardData)).toEqual([document]);
  });

  it("纯文字剪贴板不产生附件", () => {
    const clipboardData = {
      items: [{ kind: "string", getAsFile: () => null }],
      files: []
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(extractClipboardFiles(clipboardData)).toEqual([]);
  });
});
