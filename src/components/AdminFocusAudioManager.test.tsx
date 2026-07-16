import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listFocusAudioTracksMock, uploadFocusAudioTrackMock } = vi.hoisted(() => ({
  listFocusAudioTracksMock: vi.fn(),
  uploadFocusAudioTrackMock: vi.fn()
}));

vi.mock("../lib/focusAudio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/focusAudio")>();
  return {
    ...actual,
    listFocusAudioTracks: listFocusAudioTracksMock,
    uploadFocusAudioTrack: uploadFocusAudioTrackMock,
    setFocusAudioEnabled: vi.fn(),
    deleteFocusAudioTrack: vi.fn()
  };
});

import { AdminFocusAudioManager, titleFromFileName } from "./AdminFocusAudioManager";

describe("专注音频批量上传", () => {
  afterEach(cleanup);

  beforeEach(() => {
    listFocusAudioTracksMock.mockReset().mockResolvedValue([]);
    uploadFocusAudioTrackMock.mockReset().mockResolvedValue({});
  });

  it("从文件名生成可编辑的默认名称", () => {
    expect(titleFromFileName("钢琴Saying GoodBye.mp3")).toBe("钢琴Saying GoodBye");
    expect(titleFromFileName("雨声.舒缓.ogg")).toBe("雨声.舒缓");
  });

  it("一次选择多个文件并按编辑后的名称逐个发布", async () => {
    const { container } = render(<AdminFocusAudioManager />);
    await screen.findByText("还没有上传音频。");
    const files = [
      new File(["one"], "钢琴Saying GoodBye.mp3", { type: "audio/mpeg" }),
      new File(["two"], "雨声.ogg", { type: "audio/ogg" })
    ];
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    expect(fileInput).toHaveAttribute("multiple");
    fireEvent.change(fileInput, { target: { files } });
    expect(screen.getByLabelText("钢琴Saying GoodBye.mp3 的名称")).toHaveValue("钢琴Saying GoodBye");
    expect(screen.getByLabelText("雨声.ogg 的名称")).toHaveValue("雨声");

    fireEvent.change(screen.getByLabelText("雨声.ogg 的名称"), { target: { value: "夜间雨声" } });
    fireEvent.click(screen.getByRole("button", { name: "上传 2 个并发布" }));

    await waitFor(() => expect(uploadFocusAudioTrackMock).toHaveBeenCalledTimes(2));
    expect(uploadFocusAudioTrackMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ file: files[0], title: "钢琴Saying GoodBye", kind: "white_noise" }));
    expect(uploadFocusAudioTrackMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ file: files[1], title: "夜间雨声", kind: "white_noise" }));
    expect(await screen.findByText("已上传并发布 2 个音频。")).toBeInTheDocument();
  });

  it("批量上传失败时仅保留失败项目以便重试", async () => {
    uploadFocusAudioTrackMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("网络中断"));
    const { container } = render(<AdminFocusAudioManager />);
    await screen.findByText("还没有上传音频。");
    const files = [
      new File(["one"], "海浪.mp3", { type: "audio/mpeg" }),
      new File(["two"], "雨声.ogg", { type: "audio/ogg" })
    ];

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: "上传 2 个并发布" }));

    expect(await screen.findByText("已上传 1 个，1 个失败，请检查后重试。")).toBeInTheDocument();
    expect(screen.queryByLabelText("海浪.mp3 的名称")).not.toBeInTheDocument();
    expect(screen.getByLabelText("雨声.ogg 的名称")).toHaveValue("雨声");
    expect(screen.getByText(/网络中断/)).toBeInTheDocument();
  });
});
