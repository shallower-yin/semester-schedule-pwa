import { describe, expect, it } from "vitest";
import { timeRangesOverlap } from "./conflicts";

describe("事项时间冲突", () => {
  it("结束时间等于下一项开始时间时不算冲突", () => {
    expect(timeRangesOverlap("17:00", "17:30", "17:30", "19:00")).toBe(false);
    expect(timeRangesOverlap("17:30", "19:00", "19:00", "20:30")).toBe(false);
  });

  it("时间区间实际相交时仍算冲突", () => {
    expect(timeRangesOverlap("17:00", "18:00", "17:30", "19:00")).toBe(true);
  });
});
