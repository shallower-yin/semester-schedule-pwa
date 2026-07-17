import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, validateAudioFile } from "./audioTranscription";

describe("音频转写文件校验", () => {
  it("接受受支持的常见音频格式并拒绝其他格式", () => {
    expect(() => validateAudioFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["audio"], "meeting.wav", { type: "audio/wav" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["audio"], "meeting.flac", { type: "audio/flac" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["audio"], "meeting.m4a", { type: "audio/mp4" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["audio"], "meeting.ogg", { type: "audio/ogg" }))).not.toThrow();
    expect(() => validateAudioFile(new File(["video"], "meeting.mp4", { type: "video/mp4" }))).toThrow("仅支持 MP3、WAV、FLAC、M4A 和 OGG");
  });

  it("拒绝超过前端安全上限的文件", () => {
    const large = new File(["audio"], "large.wav", { type: "audio/wav" });
    Object.defineProperty(large, "size", { value: MAX_AUDIO_BYTES + 1 });
    expect(() => validateAudioFile(large)).toThrow("不能超过 100 MB");
  });
});
