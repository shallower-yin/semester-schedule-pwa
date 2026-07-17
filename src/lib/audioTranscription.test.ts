import { describe, expect, it } from "vitest";
import { validateAudioFile } from "./audioTranscription";

describe("音频转写文件校验", () => {
  it("接受 MP3 和 WAV 并拒绝其他格式", () => {
    expect(() => validateAudioFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["audio"], "meeting.wav", { type: "audio/wav" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["video"], "meeting.mp4", { type: "video/mp4" }))).toThrow("仅支持 MP3 和 WAV");
  });

  it("拒绝超过前端安全上限的文件", () => {
    const large = new File([new Uint8Array(7 * 1024 * 1024 + 1)], "large.wav", { type: "audio/wav" });
    expect(() => validateAudioFile(large)).toThrow("不能超过 7 MB");
  });
});
