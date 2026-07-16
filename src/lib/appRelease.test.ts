import { beforeEach, describe, expect, it } from "vitest";
import { shouldShowRelease, skipReleaseVersion, type AppRelease } from "./appRelease";

const release: AppRelease = {
  version: "2026.07.18.2",
  commit: "abc1234",
  title: "功能更新",
  notes: ["新增功能"],
  publishedAt: "2026-07-18T00:00:00.000Z",
  appUrl: "https://example.com/app/"
};

describe("版本更新说明", () => {
  beforeEach(() => localStorage.clear());

  it("只对不同于当前版本的新版本显示", () => {
    expect(shouldShowRelease("2026.07.18.1", release)).toBe(true);
    expect(shouldShowRelease("2026.07.18.2", release)).toBe(false);
    expect(shouldShowRelease("2026.07.18.3", release)).toBe(false);
  });

  it("跳过当前版本后不再重复提示", () => {
    skipReleaseVersion(release.version);
    expect(shouldShowRelease("2026.07.18.1", release)).toBe(false);
    expect(shouldShowRelease("2026.07.18.1", { ...release, version: "2026.07.18.3" })).toBe(true);
  });
});
