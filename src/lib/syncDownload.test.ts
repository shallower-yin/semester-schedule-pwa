import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, queueChange } from "../db";
import type { EventOccurrenceState, FocusSession, HealthLog, SyncFields } from "../types";
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
  reset() {
    this.tables = new Map();
    this.maxRowsPerRequest = 1000;
    this.servedRowsCap = null;
    this.upsertCalls = [];
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

    const builder = {
      select(_columns?: string, options?: { count?: string }) {
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
          return Promise.resolve({ data: null, error: null, count: null }).then(onFulfilled, onRejected);
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
        const data = rows.slice(start, start + limit);
        const result: MockQueryResult = {
          data,
          error: null,
          count: countMode === "exact" ? totalCount : null
        };
        return Promise.resolve(result).then(onFulfilled, onRejected);
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

describe("上传前自动修复历史重复队列", () => {
  beforeEach(async () => {
    mockRemote.reset();
    await clearLocalTables();
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

  it("本地有待传队列项时，纯拉取不覆盖该记录并计入 kept_local", async () => {
    const local: HealthLog = { ...healthLog(0), amount: 999 };
    await db.healthLogs.put(local);
    await queueChange("healthLogs", local.id);
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
    await queueChange("eventOccurrenceStates", local.id);
    mockRemote.tables.set("event_occurrence_states", [
      toRemoteRow(occurrenceState("occ-1", { completed: false }) as unknown as HealthLog)
    ]);

    const result = await pullRemoteNow(USER_ID);

    expect(result.kept_local).toBe(1);
    expect((await db.eventOccurrenceStates.get("occ-1"))?.completed).toBe(true);
  });
});
