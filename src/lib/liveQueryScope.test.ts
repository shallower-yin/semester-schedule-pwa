import { describe, expect, it } from "vitest";
import { currentLiveQueryValue, currentOwnerRecord, scopedLiveQueryValue } from "./liveQueryScope";

describe("账号范围内的 Dexie 实时查询", () => {
  it("切换账号时不会消费上一个订阅保留的旧结果", () => {
    const previous = scopedLiveQueryValue("alice", [{ id: "private-event" }]);

    expect(currentLiveQueryValue(previous, "bob")).toBeUndefined();
  });

  it("仅返回当前账号和依赖代次的结果，并保留合法空值", () => {
    expect(currentLiveQueryValue(scopedLiveQueryValue("alice:semester-1", []), "alice:semester-1")).toEqual([]);
    expect(currentLiveQueryValue(scopedLiveQueryValue("alice", null), "alice")).toBeNull();
  });

  it("账号切换后不再展示旧账号仍处于编辑状态的记录", () => {
    const aliceMemo = { id: "memo-1", user_id: "alice" };

    expect(currentOwnerRecord(aliceMemo, "alice")).toBe(aliceMemo);
    expect(currentOwnerRecord(aliceMemo, "bob")).toBeUndefined();
    expect(currentOwnerRecord(null, "bob")).toBeNull();
  });
});
