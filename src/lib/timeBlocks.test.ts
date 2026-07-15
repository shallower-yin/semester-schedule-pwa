import { describe, expect, it } from "vitest";
import type { ClassPeriod, Weekday } from "../types";
import { buildDisplayRows, rowRangeForTime, timePlacementForRows } from "./timeBlocks";

function block(index: number, weekday: Weekday = 1, kind: "period" | "break" = "period"): ClassPeriod {
  const hour = 7 + index;
  return {
    id: `${weekday}-${index}-${kind}`,
    user_id: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    semester_id: "semester",
    weekday,
    period_number: kind === "period" ? index : -index,
    kind,
    sort_order: index,
    name: kind === "period" ? `第 ${index} 节` : "午休",
    start_time: `${String(hour).padStart(2, "0")}:00`,
    end_time: `${String(hour).padStart(2, "0")}:45`
  };
}

describe("灵活时间块", () => {
  it("支持超过 12 个节次且不截断", () => {
    const rows = buildDisplayRows(Array.from({ length: 15 }, (_, index) => block(index + 1)));
    const periodRows = rows.filter((row) => row.kind === "period");
    expect(periodRows).toHaveLength(15);
    expect(periodRows.at(-1)?.name).toBe("第 15 节");
  });

  it("相同时间的不同星期共用左侧时间行", () => {
    const monday = block(1, 1);
    const tuesday = { ...block(1, 2), name: "上午第一节" };
    expect(buildDisplayRows([monday, tuesday]).filter((row) => row.kind === "period")).toHaveLength(1);
  });

  it("事项可以跨越可编辑休息时段", () => {
    const rows = buildDisplayRows([block(1), block(2, 1, "break"), block(3)]);
    expect(rowRangeForTime(rows, "08:00", "10:45")).toEqual([1, 4]);
  });

  it("保留事项在节次内部的真实分钟偏移", () => {
    const rows = buildDisplayRows([block(1)]);
    expect(timePlacementForRows(rows, "08:15", "08:40")).toEqual({
      firstRow: 1,
      endRow: 2,
      startOffset: 1 / 3,
      endOffset: 1 / 9
    });
  });

  it("在首节前和末节后补充清晨与深夜时间行", () => {
    const rows = buildDisplayRows([]);
    expect(rows[0]).toMatchObject({ name: "清晨", startTime: "00:00", endTime: "08:30", kind: "boundary" });
    expect(rows.at(-1)).toMatchObject({ name: "深夜", startTime: "21:45", endTime: "24:00", kind: "boundary" });
    expect(timePlacementForRows(rows, "07:30", "08:00")).toMatchObject({ firstRow: 0, endRow: 1, startOffset: 15 / 17, endOffset: 1 / 17 });
    expect(timePlacementForRows(rows, "22:30", "23:00")).toMatchObject({ firstRow: rows.length - 1, endRow: rows.length, startOffset: 1 / 3, endOffset: 4 / 9 });
  });

  it("为半小时以上的无课空档补充可定位时间行", () => {
    const rows = buildDisplayRows([]);
    expect(rows).toContainEqual(expect.objectContaining({ name: "晚间", startTime: "17:00", endTime: "18:30", kind: "break" }));
    const placement = timePlacementForRows(rows, "17:00", "17:30");
    expect(rows[placement.firstRow]).toMatchObject({ startTime: "17:00", endTime: "18:30" });
    expect(placement).toMatchObject({ startOffset: 0, endOffset: 2 / 3 });
  });
});
