import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_STATUS_CHANGED_EVENT, backupIsDue, getLastBackupAt, markBackupExported } from "./backupStatus";

describe("备份状态", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("记录最近一次导出时间并通知界面刷新", () => {
    const listener = vi.fn();
    window.addEventListener(BACKUP_STATUS_CHANGED_EVENT, listener);

    markBackupExported(new Date("2026-07-09T12:00:00.000Z"));

    expect(getLastBackupAt()).toBe("2026-07-09T12:00:00.000Z");
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(BACKUP_STATUS_CHANGED_EVENT, listener);
  });

  it("超过 7 天后提示需要再次备份", () => {
    markBackupExported(new Date("2026-07-01T00:00:00.000Z"));

    expect(backupIsDue(new Date("2026-07-07T23:59:59.000Z"))).toBe(false);
    expect(backupIsDue(new Date("2026-07-08T00:00:00.000Z"))).toBe(true);
  });
});
