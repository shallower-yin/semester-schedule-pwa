import { describe, expect, it } from "vitest";
import { occurrenceLookupFilters } from "./sync";

describe("事项状态上传查重条件", () => {
  it("使用事件与日期成对 AND，而不是扁平 OR", () => {
    expect(occurrenceLookupFilters([
      { event_id: "event-1", occurrence_date: "2026-07-01" },
      { event_id: "event-2", occurrence_date: "2026-07-02" }
    ])).toEqual([
      "and(event_id.eq.event-1,occurrence_date.eq.2026-07-01),and(event_id.eq.event-2,occurrence_date.eq.2026-07-02)"
    ]);
  });

  it("去重并按固定数量分批，避免命中远端行数截断", () => {
    const pairs = Array.from({ length: 205 }, (_, index) => ({
      event_id: `event-${index}`,
      occurrence_date: "2026-07-31"
    }));
    pairs.push(pairs[0]);

    const filters = occurrenceLookupFilters(pairs, 100);

    expect(filters).toHaveLength(3);
    expect(filters[0].match(/and\(/g)).toHaveLength(100);
    expect(filters[1].match(/and\(/g)).toHaveLength(100);
    expect(filters[2].match(/and\(/g)).toHaveLength(5);
  });
});
