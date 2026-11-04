import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, putRecordAndQueue, queueChange } from "../db";
import { hardDeleteLocalRecord } from "./hardDelete";
import type { EventOccurrenceState, FocusSession, HealthLog, SyncFields, TodoItem } from "../types";
import { pullRemoteNow, syncNow, SYNC_TABLES } from "./sync";

interface MockQueryResult {
  data: Record<string, unknown>[] | null;
  error: { code?: string; message: string } | null;
  count: number | null;
}

const mockRemote = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  // 模拟 PostgREST 单次响应的 max rows 上限（真实默认 1000）
  maxRowsPerRequest: 1000,
  // 模拟异常场景：无论怎么分页，只有前 N 行可以被取到（count 仍按全量上报）
  servedRowsCap: null as number | null,
  upsertCalls: [] as Array<{ tableName: string; payloads: Record<string, unknown>[] }>,
  beforeUpsertResponse: null as null | (() => Promise<void>),
  selectCalls: [] as string[],
  selectQueries: [] as Array<{ tableName: string; columns: string; ids: string[] | null; rowCount: number }>,
  beforeSelectResponse: null as null | ((tableName: string) => Promise<void>),
  reset() {
    this.tables = new Map();
    this.maxRowsPerRequest = 1000;
    this.servedRowsCap = null;
    this.upsertCalls = [];
    this.beforeUpsertResponse = null;
    this.selectCalls = [];
    this.selectQueries = [];
    this.beforeSelectResponse = null;
  }
}));

vi.mock("./supabase", () => {
  function createBuilder(tableName: string) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let orderKey: string | null = null;
    let orderAscending = true;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let countMode: string | null = null;
    let mutation: "delete" | "update" | "upsert" | null = null;
    let mutationPayloads: Record<string, unknown>[] = [];
    let selectedColumns = "*";
    let selectedIds: string[] | null = null;

    const builder = {
      select(_columns?: string, options?: { count?: string }) {
        selectedColumns = _columns ?? "*";
        countMode = options?.count ?? null;
        return builder;
      },
      delete() {
        mutation = "delete";
        return builder;
      },
      update(_payload: Record<string, unknown>) {
        mutation = "update";
        return builder;
      },
      upsert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        mutation = "upsert";
        mutationPayloads = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => String(row[column]) === String(value));
        return builder;
      },
      in(column: string, values: unknown[]) {
        const set = new Set(values.map((value) => String(value)));
        if (column === "id") selectedIds = [...set];
        filters.push((row) => set.has(String(row[column])));
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderKey = column;
        orderAscending = options?.ascending ?? true;
        return builder;
      },
      range(from: number, to: number) {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      },
      overrideTypes() {
        return builder;
      },
      then(
        onFulfilled: (result: MockQueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        if (mutation === "upsert") {
          mockRemote.upsertCalls.push({ tableName, payloads: mutationPayloads });
          const rows = [...(mockRemote.tables.get(tableName) ?? [])];
          for (const payload of mutationPayloads) {
            const index = rows.findIndex((row) => String(row.id) === String(payload.id));
            if (index >= 0) rows[index] = { ...rows[index], ...payload, server_updated_at: "2026-07-01T08:00:00.000Z" };
            else rows.push({ ...payload, server_updated_at: "2026-07-01T08:00:00.000Z" });
          }
          mockRemote.tables.set(tableName, rows);
          return Promise.resolve().then(async () => {
            await mockRemote.beforeUpsertResponse?.();
            return { data: null, error: null, count: null };
          }).then(onFulfilled, onRejected);
        }
        if (mutation) {
          return Promise.resolve({ data: null, error: null, count: null }).then(onFulfilled, onRejected);
        }
        const source = mockRemote.tables.get(tableName) ?? [];
        let rows = source.filter((row) => filters.every((filter) => filter(row)));
        if (orderKey) {
          const key = orderKey;
          rows = [...rows].sort((left, right) => {
            const compared = String(left[key]).localeCompare(String(right[key]));
            return orderAscending ? compared : -compared;
          });
        }
        const totalCount = rows.length;
        if (mockRemote.servedRowsCap != null) {
          rows = rows.slice(0, mockRemote.servedRowsCap);
        }
        const start = rangeFrom ?? 0;
        const requested = rangeTo == null ? Number.POSITIVE_INFINITY : rangeTo - start + 1;
        const limit = Math.min(requested, mockRemote.maxRowsPerRequest);
        const columns = selectedColumns.split(",").map((column) => column.trim());
        const data = rows.slice(start, start + limit).map((row) => selectedColumns === "*"
          ? { ...row }
          : Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]])));
        const result: MockQueryResult = {
          data,
          error: null,
          count: countMode === "exact" ? totalCount : null
        };
        mockRemote.selectCalls.push(tableName);
        mockRemote.selectQueries.push({ tableName, columns: selectedColumns, ids: selectedIds, rowCount: data.length });
        return Promise.resolve().then(async () => {
          await mockRemote.beforeSelectResponse?.(tableName);
          return result;
        }).then(onFulfilled, onRejected);
      }
    };
    return builder;
  }

  return {
    supabase: { from: (tableName: string) => createBuilder(tableName) },
    supabaseConfigured: true,
    supabaseUrl: "http://mock.local",
    supabasePublishableKey: "mock-key"
  };
});

const USER_ID = "33333333-3333-4333-8333-333333333333";
// 上限调小后用 250 行即可覆盖多页分页，避免向 fake-indexeddb 写上千行拖慢测试
const PAGE_LIMIT = 100;
const TOTAL_ROWS = 250;

function fields(id: string): SyncFields {
  return {
    id,
    user_id: USER_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111"
  };
}

function healthLog(index: number): HealthLog {
  return {
    ...fields(`log-${String(index).padStart(6, "0")}`),
    kind: "water",
    logged_at: "2026-07-01T08:00:00.000Z",
    amount: 200,
    unit: "ml",
    activity: null,
    note: ""
  };
}

function toRemoteRow(log: HealthLog): Record<string, unknown> {
  return { ...log, server_updated_at: "2026-07-01T08:00:00.000Z" };
}

function todo(id: string): TodoItem {
  return {
    ...fields(id),
    title: "整理待办同步",
    color: "#cfeeff",
    sort_order: 2,
    is_pinned: true,
    completed_at: null,
    reminder_enabled: true,
    reminder_at: "2026-09-20T02:00:00.000Z",
    reminder_sent_at: null
  };
}

async function clearLocalTables() {
  for (const table of SYNC_TABLES) {
    await db.table(table.local).clear();
  }
  await db.syncQueue.clear();
}

describe("云端下载分页与镜像删除保护", () => {
  beforeEach(async () => {
    mockRemote.reset();
    await clearLocalTables();
  });

  it("独立数据表最多并行下载4张，全部取回后再合并", async () => {
    let activeRequests = 0;
    let peakRequests = 0;
    mockRemote.beforeSelectResponse = async () => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      activeRequests -= 1;
    };
    mockRemote.tables.set("todos", [{ ...todo("parallel-todo") }]);

    const result = await pullRemoteNow(USER_ID);

    expect(peakRequests).toBe(4);
    expect(activeRequests).toBe(0);
    expect(mockRemote.selectCalls).toEqual(SYNC_TABLES.map((table) => table.remote));
    expect(result.downloaded).toBe(1);
    expect(await db.todos.get("parallel-todo")).toMatchObject({ title: "整理待办同步" });
  });

  it("并行批次下载失败会等待本批请求结束，不删除本地或继续请求后续表", async () => {
    const local = healthLog(0);
    await db.healthLogs.put(local);
    const previousSync = "2026-07-01T00:00:00.000Z";
    localStorage.setItem(`semester-schedule-last-sync:${USER_ID}`, previousSync);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockRemote.beforeSelectResponse = async (tableName) => {
      if (tableName === "categories") throw new Error("categories 下载失败：network error");
      await gate;
    };
    let settled = false;
    const request = pullRemoteNow(USER_ID).finally(() => { settled = true; });
    const rejection = expect(request).rejects.toThrow("categories 下载失败");

    await vi.waitFor(() => expect(mockRemote.selectCalls).toHaveLength(4));
    expect(settled).toBe(false);
    release();
    await rejection;

    expect(mockRemote.selectCalls).toHaveLength(4);
    expect(await db.healthLogs.get(local.id)).toEqual(local);
    expect(localStorage.getItem(`semester-schedule-last-sync:${USER_ID}`)).toBe(previousSync);
  });

  it("云端超过单次响应上限时分页取全", async () => {
    mockRemote.maxRowsPerRequest = PAGE_LIMIT;
    const logs = Array.from({ length: TOTAL_ROWS }, (_, index) => healthLog(index));
    mockRemote.tables.set("health_logs", logs.map(toRemoteRow));

    const result = await pullRemoteNow(USER_ID);

    expect(result.downloaded).toBe(TOTAL_ROWS);
    expect(await db.healthLogs.count()).toBe(TOTAL_ROWS);
  });

  it("云端行数取不全时跳过该表镜像删除，保留本地记录", async () => {
    mockRemote.maxRowsPerRequest = PAGE_LIMIT;
    mockRemote.servedRowsCap = PAGE_LIMIT;
    const logs = Array.from({ length: TOTAL_ROWS }, (_, index) => healthLog(index));
    await db.healthLogs.bulkPut(logs);
    mockRemote.tables.set("health_logs", logs.map(toRemoteRow));

    await pullRemoteNow(USER_ID);

    expect(await db.healthLogs.count()).toBe(TOTAL_ROWS);
  });

  it("云端已删除且不在待传队列的记录仍会被镜像删除", async () => {
    const kept = [healthLog(0), healthLog(1)];
    const removedLocally = healthLog(2);
    await db.healthLogs.bulkPut([...kept, removedLocally]);
    mockRemote.tables.set("health_logs", kept.map(toRemoteRow));

    await pullRemoteNow(USER_ID);

    expect(await db.healthLogs.count()).toBe(2);
    expect(await db.healthLogs.get(removedLocally.id)).toBeUndefined();
  });
});

describe("自动同步只下载有变化的记录", () => {
  beforeEach(async () => {
    mockRemote.reset();
    localStorage.clear();
    await clearLocalTables();
  });

  function healthBodyQueries() {
    return mockRemote.selectQueries.filter((query) => query.tableName === "health_logs" && query.columns === "*");
  }

  it("首次下载完整内容，之后无变化只比较版本，不重传正文或重写本地记录", async () => {
    const log = { ...healthLog(0), note: "已有长笔记".repeat(1000) };
    mockRemote.tables.set("health_logs", [toRemoteRow(log)]);
    expect((await syncNow(USER_ID)).downloaded).toBe(1);
    expect(healthBodyQueries()).toHaveLength(1);
    mockRemote.selectQueries = [];
    const onUpdate = vi.fn();
    db.healthLogs.hook("updating", onUpdate);
    try {
      const result = await syncNow(USER_ID);

      expect(result.downloaded).toBe(0);
      expect(healthBodyQueries()).toHaveLength(0);
      expect(mockRemote.selectQueries.find((query) => query.tableName === "health_logs")?.columns)
        .toBe("id, version, updated_at, server_updated_at, deleted_at");
      expect(onUpdate).not.toHaveBeenCalled();
      expect((await db.healthLogs.get(log.id))?.note).toBe(log.note);
    } finally {
      db.healthLogs.hook("updating").unsubscribe(onUpdate);
    }
  });

  it("只取新增和变化的正文，并通过ID清单同步另一端的硬删除", async () => {
    const original = [healthLog(0), healthLog(1), healthLog(2)];
    mockRemote.tables.set("health_logs", original.map(toRemoteRow));
    await syncNow(USER_ID);
    mockRemote.selectQueries = [];
    const changed = { ...original[0], amount: 500, version: 2 };
    const added = healthLog(3);
    mockRemote.tables.set("health_logs", [changed, original[2], added].map(toRemoteRow));

    const result = await syncNow(USER_ID);

    expect(result.downloaded).toBe(2);
    expect(healthBodyQueries().map((query) => query.ids)).toEqual([[changed.id, added.id]]);
    expect((await db.healthLogs.get(changed.id))?.amount).toBe(500);
    expect(await db.healthLogs.get(original[1].id)).toBeUndefined();
    expect(await db.healthLogs.get(original[2].id)).toMatchObject(original[2]);
    expect(await db.healthLogs.get(added.id)).toMatchObject(added);
  });

  it("本地缓存缺少记录时会补取，不依赖上次同步时间跳过它", async () => {
    const logs = [healthLog(0), healthLog(1)];
    mockRemote.tables.set("health_logs", logs.map(toRemoteRow));
    await syncNow(USER_ID);
    await db.healthLogs.delete(logs[1].id);
    mockRemote.selectQueries = [];

    const result = await syncNow(USER_ID);

    expect(result.downloaded).toBe(1);
    expect(healthBodyQueries().map((query) => query.ids)).toEqual([[logs[1].id]]);
    expect(await db.healthLogs.count()).toBe(2);
  });

  it("有很多变化时分批按ID查询，服务端分页截断也能取全", async () => {
    const logs = Array.from({ length: 205 }, (_, index) => healthLog(index));
    mockRemote.tables.set("health_logs", logs.map(toRemoteRow));
    await syncNow(USER_ID);
    mockRemote.selectQueries = [];
    mockRemote.maxRowsPerRequest = 40;
    mockRemote.tables.set("health_logs", logs.map((log) => toRemoteRow({ ...log, amount: 500, version: 2 })));

    const result = await syncNow(USER_ID);

    expect(result.downloaded).toBe(logs.length);
    expect(healthBodyQueries().every((query) => query.ids != null && query.ids.length <= 100)).toBe(true);
    expect(healthBodyQueries().reduce((total, query) => total + query.rowCount, 0)).toBe(logs.length);
    expect((await db.healthLogs.toArray()).every((log) => log.amount === 500)).toBe(true);
  });

  it("版本清单取不全时保留本地数据，不把没查到的ID误判成删除", async () => {
    const logs = Array.from({ length: TOTAL_ROWS }, (_, index) => healthLog(index));
    mockRemote.tables.set("health_logs", logs.map(toRemoteRow));
    await syncNow(USER_ID);
    mockRemote.maxRowsPerRequest = PAGE_LIMIT;
    mockRemote.servedRowsCap = PAGE_LIMIT;
    mockRemote.tables.set("health_logs", logs.slice(1).map(toRemoteRow));
    mockRemote.selectQueries = [];

    await syncNow(USER_ID);

    expect(healthBodyQueries()).toHaveLength(0);
    expect(await db.healthLogs.count()).toBe(TOTAL_ROWS);
  });

  it("差异正文下载失败不覆盖缓存或推进同步记录，重试仍会补取", async () => {
    const log = healthLog(0);
    mockRemote.tables.set("health_logs", [toRemoteRow(log)]);
    await syncNow(USER_ID);
    const lastSync = localStorage.getItem(`semester-schedule-last-sync:${USER_ID}`);
    mockRemote.tables.set("health_logs", [toRemoteRow({ ...log, amount: 500, version: 2 })]);
    mockRemote.beforeSelectResponse = async (tableName) => {
      if (tableName === "health_logs" && mockRemote.selectQueries.at(-1)?.columns === "*") {
        throw new Error("差异下载失败");
      }
    };

    await expect(syncNow(USER_ID)).rejects.toThrow("差异下载失败");

    expect((await db.healthLogs.get(log.id))?.amount).toBe(200);
    expect(localStorage.getItem(`semester-schedule-last-sync:${USER_ID}`)).toBe(lastSync);
    mockRemote.beforeSelectResponse = null;
    expect((await syncNow(USER_ID)).downloaded).toBe(1);
    expect((await db.healthLogs.get(log.id))?.amount).toBe(500);
  });

  it("差异下载期间的本机编辑仍保留在队列，不被较早的远端结果覆盖", async () => {
    const log = healthLog(0);
    mockRemote.tables.set("health_logs", [toRemoteRow(log)]);
    await syncNow(USER_ID);
    mockRemote.tables.set("health_logs", [toRemoteRow({ ...log, amount: 500, version: 2 })]);
    mockRemote.beforeSelectResponse = async (tableName) => {
      if (tableName !== "health_logs" || mockRemote.selectQueries.at(-1)?.columns !== "*") return;
      mockRemote.beforeSelectResponse = null;
      await putRecordAndQueue("healthLogs", {
        ...log, amount: 999, version: 3, updated_at: "2026-07-03T00:00:00.000Z"
      });
    };

    const result = await syncNow(USER_ID);

    expect(result.kept_local).toBe(1);
    expect(result.downloaded).toBe(0);
    expect((await db.healthLogs.get(log.id))?.amount).toBe(999);
    expect(await db.syncQueue.where("record_id").equals(log.id).count()).toBe(1);
  });

  it("手动重新拉取云端仍下载全文，可以修复版本相同但内容损坏的本地缓存", async () => {
    const log = healthLog(0);
    mockRemote.tables.set("health_logs", [toRemoteRow(log)]);
    await syncNow(USER_ID);
    await db.healthLogs.update(log.id, { note: "本地缓存损坏" });
    mockRemote.selectQueries = [];

    await pullRemoteNow(USER_ID);

    expect(healthBodyQueries()).toEqual([expect.objectContaining({ ids: null, rowCount: 1 })]);
    expect((await db.healthLogs.get(log.id))?.note).toBe(log.note);
  });

  it("遇到历史软删除会取完整关联记录，仍正确清理未变化的子记录", async () => {
    const semester = { ...fields("legacy-semester"), name: "测试学期", start_date: "2026-01-01", total_weeks: 20, is_current: true };
    const course = { ...fields("legacy-course"), semester_id: semester.id, name: "高数", teacher: "", classroom: "", color: "#3157d5", note: "" };
    const stamp = { server_updated_at: "2026-07-01T08:00:00.000Z" };
    mockRemote.tables.set("semesters", [{ ...semester, ...stamp }]);
    mockRemote.tables.set("courses", [{ ...course, ...stamp }]);
    await syncNow(USER_ID);
    mockRemote.tables.set("semesters", [{ ...semester, ...stamp, version: 2, deleted_at: "2026-07-02T00:00:00.000Z" }]);
    mockRemote.selectQueries = [];

    await syncNow(USER_ID);

    expect(mockRemote.selectQueries).toContainEqual(expect.objectContaining({ tableName: "courses", columns: "*", ids: null }));
    expect(await db.semesters.get(semester.id)).toBeUndefined();
    expect(await db.courses.get(course.id)).toBeUndefined();
  });
});

describe("上传前自动修复历史重复队列", () => {
  beforeEach(async () => {
    mockRemote.reset();
    await clearLocalTables();
  });

  it("上传等待期间再次编辑不会被旧请求清除待传操作", async () => {
    const item = todo("todo-edit-during-upload");
    await putRecordAndQueue("todos", item);
    mockRemote.beforeUpsertResponse = async () => {
      mockRemote.beforeUpsertResponse = null;
      await putRecordAndQueue("todos", { ...item, title: "上传时的新编辑", version: 2 });
    };

    await syncNow(USER_ID);

    expect((await db.todos.get(item.id))?.title).toBe("上传时的新编辑");
    expect(await db.syncQueue.where("record_id").equals(item.id).count()).toBe(1);
    await syncNow(USER_ID);
    expect(mockRemote.tables.get("todos")?.[0].title).toBe("上传时的新编辑");
    expect(await db.syncQueue.where("record_id").equals(item.id).count()).toBe(0);
  });

  it("上传等待期间删除不会丢失删除操作或复活本地记录", async () => {
    const item = todo("todo-delete-during-upload");
    await putRecordAndQueue("todos", item);
    mockRemote.beforeUpsertResponse = async () => {
      mockRemote.beforeUpsertResponse = null;
      await hardDeleteLocalRecord("todos", item.id);
    };

    await syncNow(USER_ID);

    expect(await db.todos.get(item.id)).toBeUndefined();
    expect(await db.syncQueue.where("record_id").equals(item.id).first()).toMatchObject({ operation: "delete" });
  });

  it("同一条专注记录只生成一个 upsert 载荷并清空重复队列", async () => {
    const session: FocusSession = {
      ...fields("44444444-4444-4444-8444-444444444444"),
      mode: "pomodoro",
      task_title: "复习高数",
      linked_event_id: null,
      planned_seconds: 1500,
      duration_seconds: 1500,
      started_at: "2026-07-31T08:00:00.000Z",
      ended_at: "2026-07-31T08:25:00.000Z",
      completed: true,
      interrupted: false,
      pomodoro_plan_id: null,
      pomodoro_round: null
    };
    await db.focusSessions.put(session);
    await db.syncQueue.bulkPut([
      { id: "queue-focus-old", owner_id: USER_ID, table_name: "focusSessions", record_id: session.id, operation: "upsert", queued_at: "2026-07-31T08:25:01.000Z", attempts: 2, last_error: "ON CONFLICT" },
      { id: "queue-focus-new", owner_id: USER_ID, table_name: "focusSessions", record_id: session.id, operation: "upsert", queued_at: "2026-07-31T08:25:02.000Z", attempts: 1, last_error: "ON CONFLICT" }
    ]);

    const result = await syncNow(USER_ID);

    const focusUploads = mockRemote.upsertCalls.filter((call) => call.tableName === "focus_sessions");
    expect(focusUploads).toHaveLength(1);
    expect(focusUploads[0].payloads).toHaveLength(1);
    expect(focusUploads[0].payloads[0].id).toBe(session.id);
    expect(result.uploaded).toBe(1);
    expect(await db.syncQueue.where("owner_id").equals(USER_ID).count()).toBe(0);
  });

  it("待办会上传完整的独立字段并清空同步队列", async () => {
    const item = todo("todo-1");
    await db.todos.put(item);
    await queueChange("todos", item.id, "upsert", USER_ID);

    const result = await syncNow(USER_ID);

    const uploads = mockRemote.upsertCalls.filter((call) => call.tableName === "todos");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].payloads).toEqual([expect.objectContaining({
      id: item.id,
      title: item.title,
      color: item.color,
      sort_order: item.sort_order,
      is_pinned: true,
      completed_at: null,
      reminder_enabled: true,
      reminder_at: item.reminder_at,
      reminder_sent_at: null
    })]);
    expect(result.uploaded).toBe(1);
    expect(await db.syncQueue.where("owner_id").equals(USER_ID).count()).toBe(0);
  });
});

function occurrenceState(id: string, overrides: Partial<EventOccurrenceState> = {}): EventOccurrenceState {
  return {
    ...fields(id),
    event_id: "event-1",
    occurrence_date: "2026-07-01",
    completed: false,
    reminder_sent_at: null,
    ...overrides
  };
}

describe("下载侧保护本地未上传编辑", () => {
  beforeEach(async () => {
    mockRemote.reset();
    await clearLocalTables();
  });

  it("纯拉取不会复活仍在等待上传删除的记录", async () => {
    const item = todo("todo-pending-delete");
    mockRemote.tables.set("todos", [{ ...item }]);
    await queueChange("todos", item.id, "delete", USER_ID);

    await pullRemoteNow(USER_ID);

    expect(await db.todos.get(item.id)).toBeUndefined();
    expect(await db.syncQueue.where("record_id").equals(item.id).first()).toMatchObject({ operation: "delete" });
  });

  it("本地有待传队列项时，纯拉取不覆盖该记录并计入 kept_local", async () => {
    const local: HealthLog = { ...healthLog(0), amount: 999 };
    await db.healthLogs.put(local);
    await queueChange("healthLogs", local.id, "upsert", local.user_id);
    mockRemote.tables.set("health_logs", [toRemoteRow({ ...healthLog(0), amount: 111 })]);

    const result = await pullRemoteNow(USER_ID);

    expect(result.kept_local).toBe(1);
    expect(result.downloaded).toBe(0);
    expect((await db.healthLogs.get(local.id))?.amount).toBe(999);
  });

  it("本地 updated_at 更晚时，下载不覆盖较新的本地编辑", async () => {
    const local: HealthLog = { ...healthLog(0), amount: 999, updated_at: "2026-07-02T10:00:00.000Z" };
    await db.healthLogs.put(local);
    mockRemote.tables.set("health_logs", [toRemoteRow({ ...healthLog(0), amount: 111, updated_at: "2026-07-01T08:00:00.000Z" })]);

    const result = await pullRemoteNow(USER_ID);

    expect(result.kept_local).toBe(1);
    expect((await db.healthLogs.get(local.id))?.amount).toBe(999);
  });

  it("本地较旧且无待传项时，正常被云端较新记录覆盖", async () => {
    const local: HealthLog = { ...healthLog(0), amount: 999, updated_at: "2026-06-01T00:00:00.000Z" };
    await db.healthLogs.put(local);
    mockRemote.tables.set("health_logs", [toRemoteRow({ ...healthLog(0), amount: 111, updated_at: "2026-07-01T08:00:00.000Z" })]);

    const result = await pullRemoteNow(USER_ID);

    expect(result.kept_local).toBe(0);
    expect(result.downloaded).toBe(1);
    expect((await db.healthLogs.get(local.id))?.amount).toBe(111);
  });

  it("事项状态：本地有待传项时下载不覆盖打卡结果", async () => {
    const local = occurrenceState("occ-1", { completed: true, updated_at: "2026-07-01T09:00:00.000Z" });
    await db.eventOccurrenceStates.put(local);
    await queueChange("eventOccurrenceStates", local.id, "upsert", local.user_id);
    mockRemote.tables.set("event_occurrence_states", [
      toRemoteRow(occurrenceState("occ-1", { completed: false }) as unknown as HealthLog)
    ]);

    const result = await pullRemoteNow(USER_ID);

    expect(result.kept_local).toBe(1);
    expect((await db.eventOccurrenceStates.get("occ-1"))?.completed).toBe(true);
  });
});
