import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentSourcePicker } from "./AttachmentSourcePicker";

function setMobile(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe("附件来源选择", () => {
  afterEach(() => {
    cleanup();
    setMobile(false);
  });

  it("明确提供相册、拍照和文件管理器入口", () => {
    setMobile(true);
    const { container } = render(
      <AttachmentSourcePicker
        imageAccept="image/jpeg,image/png"
        documentAccept=".pdf,.docx"
        onFiles={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "选择附件来源" }));
    expect(screen.getByRole("menuitem", { name: /相册/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /拍照/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();

    const camera = screen.getByLabelText("拍照上传");
    const gallery = screen.getByLabelText("从相册选择");
    const documents = screen.getByLabelText("从文件管理器选择");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(gallery).not.toHaveAttribute("capture");
    expect(documents).not.toHaveAttribute("capture");
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(4);
  });

  it("电脑端点击附件直接打开统一文件选择器", () => {
    setMobile(false);
    render(
      <AttachmentSourcePicker
        imageAccept="image/jpeg,image/png"
        documentAccept=".pdf,.docx"
        onFiles={vi.fn()}
      />
    );
    const desktopInput = screen.getByLabelText("从电脑选择文件");
    const click = vi.spyOn(desktopInput, "click");
    fireEvent.click(screen.getByRole("button", { name: "选择附件来源" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "附件来源" })).not.toBeInTheDocument();
  });
});
