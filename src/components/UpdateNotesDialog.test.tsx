import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateNotesDialog } from "./UpdateNotesDialog";

describe("更新说明弹窗", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("展示版本内容并提供跳过、后台和立即更新", () => {
    const onSkip = vi.fn();
    const onBackgroundUpdate = vi.fn();
    const onUpdate = vi.fn();
    render(
      <UpdateNotesDialog
        currentVersion="2026.07.18.1"
        release={{ version: "2026.07.18.2", commit: "abc", title: "本次更新", notes: ["新增 AI 脑图", "修复附件选择"], publishedAt: "", appUrl: "" }}
        updating={false}
        updateMessage=""
        onSkip={onSkip}
        onBackgroundUpdate={onBackgroundUpdate}
        onUpdate={onUpdate}
      />
    );
    expect(screen.getByText("新增 AI 脑图")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "跳过此版本" }));
    fireEvent.click(screen.getByRole("button", { name: "后台更新" }));
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onBackgroundUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("通过 portal 挂载并在卸载时恢复页面滚动", () => {
    document.body.style.overflow = "auto";
    const view = render(
      <UpdateNotesDialog
        currentVersion="1"
        release={{ version: "2", commit: "abc", title: "更新", notes: [], publishedAt: "", appUrl: "" }}
        updating={false}
        updateMessage=""
        onSkip={vi.fn()}
        onBackgroundUpdate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "发现新版本" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});
