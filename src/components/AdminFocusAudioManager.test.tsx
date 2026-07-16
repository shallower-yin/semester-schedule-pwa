import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listFocusAudioTracksMock, setFocusAudioKindMock, uploadFocusAudioTrackMock } = vi.hoisted(() => ({
  listFocusAudioTracksMock: vi.fn(),
  setFocusAudioKindMock: vi.fn(),
  uploadFocusAudioTrackMock: vi.fn()
}));

vi.mock("../lib/focusAudio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/focusAudio")>();
  return {
    ...actual,
    listFocusAudioTracks: listFocusAudioTracksMock,
    setFocusAudioKind: setFocusAudioKindMock,
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
    setFocusAudioKindMock.mockReset().mockResolvedValue(undefined);
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

  it("已上传音频可以直接修改分类而无需重新上传", async () => {
    const track = {
      id: "track-1",
      title: "钢琴曲",
      kind: "white_noise" as const,
      storage_path: "white_noise/track.mp3",
      mime_type: "audio/mpeg",
      file_size: 1024,
      is_enabled: true,
      sort_order: 0,
      created_at: "2026-07-17T00:00:00Z",
      updated_at: "2026-07-17T00:00:00Z"
    };
    listFocusAudioTracksMock
      .mockResolvedValueOnce([track])
      .mockResolvedValueOnce([{ ...track, kind: "music" }]);
    render(<AdminFocusAudioManager />);

    const category = await screen.findByLabelText("钢琴曲 的分类");
    expect(category).toHaveValue("white_noise");
    fireEvent.change(category, { target: { value: "music" } });

    await waitFor(() => expect(setFocusAudioKindMock).toHaveBeenCalledWith("track-1", "music"));
    expect(await screen.findByText("“钢琴曲”已改为音乐。")).toBeInTheDocument();
    expect(screen.getByLabelText("钢琴曲 的分类")).toHaveValue("music");
    expect(uploadFocusAudioTrackMock).not.toHaveBeenCalled();
  });
});
