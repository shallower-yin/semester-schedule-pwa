import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Collection, Table, WhereClause } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { useScheduleData } from "./useScheduleData";

const tables = [
  "semesters", "courses", "courseSchedules", "courseCancellations", "events", "categories",
  "eventOccurrenceStates", "anniversaries", "memos", "todos", "focusSessions", "classPeriods"
] as const;
type DataTable = typeof tables[number];
type Row = { id: string; user_id: string; [key: string]: unknown };

function record(id: string, ownerId: string, fields: Record<string, unknown> = {}): Row {
  return {
    id, user_id: ownerId, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null, version: 1, device_id: "test", ...fields
  };
}

async function seedOwner(ownerId: string) {
  const semesterId = `${ownerId}-semester`;
  const courseId = `${ownerId}-course`;
  await db.table("semesters").put(record(semesterId, ownerId, {
    name: semesterId, is_current: true, start_date: "2026-09-01", total_weeks: 20
  }));
  await db.table("courses").put(record(courseId, ownerId, { semester_id: semesterId, name: courseId }));
  await db.table("courseSchedules").put(record(`${ownerId}-schedule`, ownerId, { course_id: courseId }));
  await db.table("classPeriods").put(record(`${ownerId}-period`, ownerId, { semester_id: semesterId }));
  for (const table of tables.filter((name) => !["semesters", "courses", "courseSchedules", "classPeriods"].includes(name))) {
    await db.table(table).put(record(`${ownerId}-${table}`, ownerId, { name: table, title: table }));
  }
}

function readGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

// Delay delivery, not the IndexedDB read itself: the real live-query subscription
// still observes the tables and deliberately retains its previous result.
function holdCollectionRead(collection: Collection<Row, string>, gate: ReturnType<typeof readGate>) {
  const original = collection.toArray.bind(collection);
  vi.spyOn(collection, "toArray").mockImplementation(() => original().then(async (rows) => {
    await gate.promise;
    return rows;
  }));
  return collection;
}

function holdFilteredReads(tableName: DataTable) {
  const gate = readGate();
  const table = db[tableName] as unknown as Table<Row, string>;
  const original = table.filter.bind(table);
  vi.spyOn(table, "filter").mockImplementation((predicate) => holdCollectionRead(original(predicate), gate));
  return gate;
}

function holdSemesterReads(tableName: "courses" | "classPeriods") {
  const gate = readGate();
  const table = db[tableName] as unknown as Table<Row, string>;
  const indexedTable: { where(index: string | string[]): WhereClause<Row, string> } = table;
  const originalWhere = indexedTable.where.bind(indexedTable);
  vi.spyOn(indexedTable, "where").mockImplementation((index) => {
    const where = originalWhere(index);
    const originalEquals = where.equals.bind(where);
    vi.spyOn(where, "equals").mockImplementation((key) => {
      const collection = originalEquals(key);
      const originalFilter = collection.filter.bind(collection);
      vi.spyOn(collection, "filter").mockImplementation((predicate) => holdCollectionRead(originalFilter(predicate), gate));
      return collection;
    });
    return where;
  });
  return gate;
}

beforeEach(async () => {
  await Promise.all(tables.map((table) => db.table(table).clear()));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("日程数据查询聚合", () => {
  it("保留各表账号/软删除过滤、学期范围、学期排序和分类去重", async () => {
    await seedOwner("alice");
    await seedOwner("bob");
    await db.table("semesters").bulkPut([
      record("alice-earlier", "alice", { is_current: false, start_date: "2026-02-01" }),
      record("alice-later", "alice", { is_current: false, start_date: "2027-02-01" }),
      record("alice-deleted-semester", "alice", { is_current: true, start_date: "2028-02-01", deleted_at: "2026-01-01" })
    ]);
    await db.table("courses").bulkPut([
      record("alice-old-course", "alice", { semester_id: "alice-earlier" }),
      record("bob-in-alice-semester", "bob", { semester_id: "alice-semester" }),
      record("alice-deleted-course", "alice", { semester_id: "alice-semester", deleted_at: "2026-01-01" })
    ]);
    await db.table("classPeriods").bulkPut([
      record("alice-old-period", "alice", { semester_id: "alice-earlier" }),
      record("bob-in-alice-periods", "bob", { semester_id: "alice-semester" }),
      record("alice-deleted-period", "alice", { semester_id: "alice-semester", deleted_at: "2026-01-01" })
    ]);
    await db.table("courseSchedules").bulkPut([
      record("alice-old-schedule", "alice", { course_id: "alice-old-course" }),
      record("bob-in-alice-schedules", "bob", { course_id: "alice-course" }),
      record("alice-deleted-schedule", "alice", { course_id: "alice-course", deleted_at: "2026-01-01" })
    ]);
    for (const table of ["courseCancellations", "events", "eventOccurrenceStates", "anniversaries", "memos", "todos", "focusSessions"] as const) {
      await db.table(table).put(record(`deleted-${table}`, "alice", { deleted_at: "2026-01-01" }));
    }
    await db.table("categories").bulkPut([
      record("alice-category-duplicate", "alice", { name: " CATEGORIES " }),
      record("alice-category-deleted", "alice", { name: "deleted", deleted_at: "2026-01-01" })
    ]);
    const { result } = renderHook(() => useScheduleData({ ownerId: "alice", authReady: true }));
    await waitFor(() => {
      expect(result.current.widgetDataReady).toBe(true);
      expect(result.current.anniversariesQuery).toBeDefined();
      expect(result.current.memos).toHaveLength(1);
    });
    expect(result.current.semester?.id).toBe("alice-semester");
    expect(result.current.semesters.map((item) => item.id)).toEqual(["alice-later", "alice-semester", "alice-earlier"]);
    expect(result.current.courses.map((item) => item.id)).toEqual(["alice-course"]);
    expect(result.current.schedules.map((item) => item.id)).toEqual(["alice-schedule"]);
    expect(result.current.periods.map((item) => item.id)).toEqual(["alice-period"]);
    expect(result.current.categories).toHaveLength(1);
    expect(result.current.categories[0].user_id).toBe("alice");
    for (const rows of [
      result.current.cancellations, result.current.events, result.current.occurrenceStates,
      result.current.anniversaries, result.current.memos, result.current.todos, result.current.focusSessions
    ]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe("alice");
      expect(rows[0].deleted_at).toBeNull();
    }
  });

  it("切账号立即屏蔽旧订阅，在新账号慢查询返回前保留undefined而非旧事项", async () => {
    await seedOwner("alice");
    await seedOwner("bob");
    const { result, rerender } = renderHook(useScheduleData, { initialProps: { ownerId: "alice", authReady: true } });
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    expect(result.current.eventsQuery?.[0].user_id).toBe("alice");
    const gate = holdFilteredReads("events");
    rerender({ ownerId: "bob", authReady: true });
    expect(result.current.semesterQuery).toBeUndefined();
    expect(result.current.eventsQuery).toBeUndefined();
    expect(result.current.anniversariesQuery).toBeUndefined();
    expect(result.current.todosQuery).toBeUndefined();
    expect(result.current.courses).toEqual([]);
    expect(result.current.schedules).toEqual([]);
    expect(result.current.periods).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.widgetDataReady).toBe(false);
    await waitFor(() => expect(result.current.semester?.id).toBe("bob-semester"));
    expect(result.current.eventsQuery).toBeUndefined();
    expect(result.current.widgetDataReady).toBe(false);
    await act(async () => { gate.release(); });
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    expect(result.current.eventsQuery?.map((item) => item.id)).toEqual(["bob-events"]);
    expect(result.current.courses.map((item) => item.id)).toEqual(["bob-course"]);
  });

  it("切学期屏蔽旧课程/节次，课程集合变化后也不消费旧课表订阅", async () => {
    await seedOwner("alice");
    await db.table("semesters").put(record("alice-next", "alice", { is_current: false, start_date: "2027-02-01" }));
    await db.table("courses").put(record("next-course", "alice", { semester_id: "alice-next" }));
    await db.table("classPeriods").put(record("next-period", "alice", { semester_id: "alice-next" }));
    await db.table("courseSchedules").put(record("next-schedule", "alice", { course_id: "next-course" }));
    const { result } = renderHook(() => useScheduleData({ ownerId: "alice", authReady: true }));
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    const coursesGate = holdSemesterReads("courses");
    const periodsGate = holdSemesterReads("classPeriods");
    const schedulesGate = holdFilteredReads("courseSchedules");
    await act(async () => {
      await db.transaction("rw", db.semesters, async () => {
        await db.semesters.update("alice-semester", { is_current: false });
        await db.semesters.update("alice-next", { is_current: true });
      });
    });
    await waitFor(() => expect(result.current.semester?.id).toBe("alice-next"));
    expect(result.current.courses).toEqual([]);
    expect(result.current.periods).toEqual([]);
    expect(result.current.schedules).toEqual([]);
    expect(result.current.widgetDataReady).toBe(false);
    await act(async () => { coursesGate.release(); });
    await waitFor(() => expect(result.current.courses.map((item) => item.id)).toEqual(["next-course"]));
    expect(result.current.schedules).toEqual([]);
    expect(result.current.widgetDataReady).toBe(false);
    await act(async () => { schedulesGate.release(); });
    await waitFor(() => expect(result.current.schedules.map((item) => item.id)).toEqual(["next-schedule"]));
    expect(result.current.periods).toEqual([]);
    expect(result.current.widgetDataReady).toBe(false);
    await act(async () => { periodsGate.release(); });
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    expect(result.current.periods.map((item) => item.id)).toEqual(["next-period"]);
  });

  it.each([
    "courseCancellations", "events", "categories", "eventOccurrenceStates", "todos", "focusSessions"
  ] as const)("小组件等待最后一项%s读取完成", async (table) => {
    await seedOwner("alice");
    const gate = holdFilteredReads(table);
    const { result } = renderHook(() => useScheduleData({ ownerId: "alice", authReady: true }));
    await waitFor(() => expect(result.current.schedules).toHaveLength(1));
    expect(result.current.widgetDataReady).toBe(false);
    await act(async () => { gate.release(); });
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
  });

  it("没有当前学期时已读空数组是就绪状态，认证未完成仍不发布", async () => {
    const { result, rerender } = renderHook(useScheduleData, { initialProps: { ownerId: "local", authReady: false } });
    expect(result.current.semesterQuery).toBeUndefined();
    await waitFor(() => expect(result.current.todosQuery).toEqual([]));
    expect(result.current.widgetDataReady).toBe(false);
    rerender({ ownerId: "local", authReady: true });
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    expect(result.current.semesterQuery).toBeNull();
    expect(result.current.semester).toBeNull();
    expect(result.current.courses).toEqual([]);
    expect(result.current.schedules).toEqual([]);
    expect(result.current.periods).toEqual([]);
  });

  it("备忘录和纪念日不属于小组件前置，慢查询不扩大原有等待范围", async () => {
    await seedOwner("alice");
    const memosGate = holdFilteredReads("memos");
    const anniversariesGate = holdFilteredReads("anniversaries");
    const { result } = renderHook(() => useScheduleData({ ownerId: "alice", authReady: true }));
    await waitFor(() => expect(result.current.widgetDataReady).toBe(true));
    expect(result.current.memos).toEqual([]);
    expect(result.current.anniversariesQuery).toBeUndefined();
    await act(async () => { memosGate.release(); anniversariesGate.release(); });
    await waitFor(() => {
      expect(result.current.memos).toHaveLength(1);
      expect(result.current.anniversariesQuery).toHaveLength(1);
    });
  });
});
