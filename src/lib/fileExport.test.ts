import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  saveFile: vi.fn(),
  isNativeApp: vi.fn(() => false)
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({ saveFile: nativeMocks.saveFile })
}));

vi.mock("./nativeApp", () => ({
  isNativeApp: nativeMocks.isNativeApp
}));

describe("文件导出适配", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeMocks.isNativeApp.mockReturnValue(false);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn()
    });
  });

  it("浏览器使用 download 链接并清理临时 URL", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { exportText } = await import("./fileExport");
    await exportText("正文", "录音:转写.txt");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("Android 通过原生文档保存器导出并清理文件名", async () => {
    nativeMocks.isNativeApp.mockReturnValue(true);
    nativeMocks.saveFile.mockResolvedValue({ saved: true, uri: "content://saved" });
    const { exportText } = await import("./fileExport");
    const result = await exportText("正文", "录音:转写.txt");
    expect(nativeMocks.saveFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "录音-转写.txt",
      mimeType: "text/plain;charset=utf-8",
      base64: expect.any(String)
    }));
    expect(result).toEqual({ saved: true, uri: "content://saved" });
  });
});
