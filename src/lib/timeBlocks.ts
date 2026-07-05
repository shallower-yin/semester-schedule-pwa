import { DEFAULT_TIME_ROWS } from "../data/defaults";
import type { ClassPeriod } from "../types";

export interface DisplayTimeRow {
  key: string;
  name: string;
  startTime: string;
  endTime: string;
  kind: "period" | "break";
}

export function buildDisplayRows(periods: ClassPeriod[]): DisplayTimeRow[] {
  const source = periods.filter((period) => !period.deleted_at);
  if (!source.length) {
    return DEFAULT_TIME_ROWS.map((row) => ({
      key: row.key,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      kind: row.kind
    }));
  }
  const rows = new Map<string, DisplayTimeRow>();
  for (const period of source) {
    const key = `${period.start_time}-${period.end_time}-${period.kind}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name: period.name,
        startTime: period.start_time,
        endTime: period.end_time,
        kind: period.kind
      });
    }
  }
  return [...rows.values()].sort(
    (left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime)
  );
}

export function rowRangeForTime(rows: DisplayTimeRow[], start: string | null, end: string | null): [number, number] {
  if (!start || !end) return [0, 1];
  let first = rows.findIndex((row) => end > row.startTime && start < row.endTime);
  if (first < 0) first = rows.findIndex((row) => start < row.startTime);
  if (first < 0) first = rows.length - 1;
  let last = first;
  rows.forEach((row, index) => {
    if (end > row.startTime && start < row.endTime) last = index;
  });
  return [first, Math.max(first + 1, last + 1)];
}
