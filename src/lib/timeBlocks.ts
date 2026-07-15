import { DEFAULT_TIME_ROWS } from "../data/defaults";
import type { ClassPeriod } from "../types";

export interface DisplayTimeRow {
  key: string;
  name: string;
  startTime: string;
  endTime: string;
  kind: "period" | "break" | "boundary";
}

export function buildDisplayRows(periods: ClassPeriod[]): DisplayTimeRow[] {
  const source = periods.filter((period) => !period.deleted_at);
  if (!source.length) {
    return addCoverageRows(DEFAULT_TIME_ROWS.map((row) => ({
      key: row.key,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      kind: row.kind
    })));
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
  return addCoverageRows([...rows.values()].sort(
    (left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime)
  ));
}

function addCoverageRows(rows: DisplayTimeRow[]): DisplayTimeRow[] {
  if (!rows.length) return rows;
  const result: DisplayTimeRow[] = [];
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (previous && minutes(row.startTime) - minutes(previous.endTime) >= 30) {
      result.push({
        key: `gap-${previous.endTime}-${row.startTime}`,
        name: previous.endTime >= "17:00" && row.startTime <= "19:00" ? "晚间" : "间隔",
        startTime: previous.endTime,
        endTime: row.startTime,
        kind: "break"
      });
    }
    result.push(row);
  });
  const first = result[0];
  const last = result[result.length - 1];
  if (first.startTime > "00:00") {
    result.unshift({ key: "early-boundary", name: "清晨", startTime: "00:00", endTime: first.startTime, kind: "boundary" });
  }
  if (last.endTime < "24:00") {
    result.push({ key: "late-boundary", name: "深夜", startTime: last.endTime, endTime: "24:00", kind: "boundary" });
  }
  return result;
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

export interface TimeRowPlacement {
  firstRow: number;
  endRow: number;
  startOffset: number;
  endOffset: number;
}

export function timePlacementForRows(rows: DisplayTimeRow[], start: string | null, end: string | null): TimeRowPlacement {
  const [firstRow, endRow] = rowRangeForTime(rows, start, end);
  if (!start || !end || !rows[firstRow] || !rows[endRow - 1]) {
    return { firstRow, endRow, startOffset: 0, endOffset: 0 };
  }
  const first = rows[firstRow];
  const last = rows[endRow - 1];
  const firstDuration = Math.max(1, minutes(first.endTime) - minutes(first.startTime));
  const lastDuration = Math.max(1, minutes(last.endTime) - minutes(last.startTime));
  return {
    firstRow,
    endRow,
    startOffset: clampFraction((minutes(start) - minutes(first.startTime)) / firstDuration),
    endOffset: clampFraction((minutes(last.endTime) - minutes(end)) / lastDuration)
  };
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}
