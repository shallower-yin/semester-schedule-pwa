import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentSourcePicker } from "./AttachmentSourcePicker";

describe("手机附件来源选择", () => {
  it("明确提供相册、拍照和文件管理器入口", () => {
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
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(3);
  });
});
