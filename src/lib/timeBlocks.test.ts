import { describe, expect, it } from "vitest";
import type { ClassPeriod, Weekday } from "../types";
import { buildDisplayRows, rowRangeForTime } from "./timeBlocks";

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
    expect(rows).toHaveLength(15);
    expect(rows.at(-1)?.name).toBe("第 15 节");
  });

  it("相同时间的不同星期共用左侧时间行", () => {
    const monday = block(1, 1);
    const tuesday = { ...block(1, 2), name: "上午第一节" };
    expect(buildDisplayRows([monday, tuesday])).toHaveLength(1);
  });

  it("事项可以跨越可编辑休息时段", () => {
    const rows = buildDisplayRows([block(1), block(2, 1, "break"), block(3)]);
    expect(rowRangeForTime(rows, "08:00", "10:45")).toEqual([0, 3]);
  });
});
