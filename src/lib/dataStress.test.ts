import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, putRecordAndQueue, queueChange } from "../db";
import type { EventItem } from "../types";
import { BACKUP_TABLES, createBackup, restoreBackup } from "./backup";
import { hardDeleteLocalRecords } from "./hardDelete";
import { completeFocusSession } from "./focusCompletion";
import { saveActiveFocus, type ActiveFocusState } from "./focus";
import { setCurrentUserId } from "./identity";
import { weekDates } from "./date";
import { buildDesktopWeekLayout, buildMobileWeekLayout, type WeekCalendarInput } from "./weekCalendarLayout";

// Synthetic, fake-indexeddb-only tests. No Supabase client or real browser DB.
const owner = "stress-owner";
function event(id: string, user_id = owner): EventItem {
  return { id, user_id, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
    version: 1, deleted_at: null, device_id: "stress-device", event_type: "event", title: id,
    start_date: "2026-07-06", end_date: "2026-07-06", start_time: "08:30", end_time: "09:15",
    all_day: false, category_id: null, color: "#123456", note: "", recurrence_type: "none",
    recurrence_until: null, recurrence_interval: 1, reminder_enabled: false, reminder_minutes_before: 10, timezone: "Asia/Shanghai" };
}
function report(name: string, count: number, concurrency: number, start: number, samples: number[] = []) {
  const sorted = [...samples].sort((a, b) => a - b);
  console.info("DATA_STRESS", JSON.stringify({ name, count, concurrency, elapsedMs: +(performance.now() - start).toFixed(2),
    ...(sorted.length ? { latencySamples: sorted.length, p50Ms: +sorted[Math.ceil(sorted.length * .5) - 1].toFixed(2),
      p95Ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2) } : {}) }));
}
beforeEach(async () => {
  localStorage.clear();
  setCurrentUserId(owner);
  for (const table of BACKUP_TABLES) await db.table(table).clear();
  await db.syncQueue.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("bounded synthetic data stress", () => {
  it("200 concurrent writes compact each record and preserve the final edit after an old acknowledgement", async () => {
    const start = performance.now();
    await putRecordAndQueue("events", event("shared"));
    const old = (await db.syncQueue.toArray())[0];
    const latencies: number[] = [];
    await Promise.all(Array.from({ length: 200 }, async (_, i) => {
      const began = performance.now();
      await putRecordAndQueue("events", { ...event("shared"), version: i + 2, title: `edit-${i}` });
      latencies.push(performance.now() - began);
    }));
    await putRecordAndQueue("events", { ...event("shared"), version: 202, title: "final" });
    await db.syncQueue.delete(old.id);
    expect(await db.events.get("shared")).toMatchObject({ version: 202, title: "final" });
    expect(await db.syncQueue.toArray()).toMatchObject([{ owner_id: owner, record_id: "shared", operation: "upsert" }]);
    expect(await db.syncQueue.count()).toBe(1);
    report("queue contention and stale acknowledgement", 200, 200, start, latencies);
  }, 30_000);

  it("200 concurrent queue operations keep two owners isolated across 100 shared IDs", async () => {
    const start = performance.now();
    await Promise.all(Array.from({ length: 200 }, (_, i) => queueChange("events", `shared-${i % 100}`, i < 100 ? "upsert" : "delete", i < 100 ? owner : "other-owner")));
    const rows = await db.syncQueue.toArray();
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map(row => `${row.owner_id}/${row.record_id}`)).size).toBe(200);
    expect(rows.filter(row => row.owner_id === owner).every(row => row.operation === "upsert")).toBe(true);
    expect(rows.filter(row => row.owner_id === "other-owner").every(row => row.operation === "delete")).toBe(true);
    report("queue owner isolation", 200, 200, start);
  }, 30_000);

  it("100 competing focus completions per owner produce exactly one receipt for each owner", async () => {
    const start = performance.now();
    const active: ActiveFocusState = { mode: "pomodoro", task_title: "stress", linked_event_id: null,
      planned_seconds: 60, started_at: "2026-07-20T00:00:00.000Z", paused_seconds: 0, pause_started_at: null };
    saveActiveFocus(owner, active); saveActiveFocus("other-owner", active);
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => completeFocusSession(i % 2 ? owner : "other-owner", active,
      { completed: true, interrupted: false, now: new Date("2026-07-20T00:01:00.000Z") })));
    expect(results.filter(result => result?.created)).toHaveLength(2);
    expect(await db.focusSessions.count()).toBe(2);
    expect(new Set((await db.focusSessions.toArray()).map(row => row.user_id)).size).toBe(2);
    expect(await db.syncQueue.count()).toBe(2);
    report("focus completion idempotency", 200, 200, start);
  }, 30_000);

  it("failure at the 100th delete rolls back every record and queue write", async () => {
    const start = performance.now();
    const records = Array.from({ length: 100 }, (_, i) => event(`delete-${i}`));
    await db.events.bulkPut(records);
    const original = db.syncQueue.put.bind(db.syncQueue);
    let writes = 0;
    vi.spyOn(db.syncQueue, "put").mockImplementation((...args) => {
      if (++writes === 100) return Promise.reject(new Error("injected last queue failure")) as ReturnType<typeof db.syncQueue.put>;
      return original(...args);
    });
    await expect(hardDeleteLocalRecords("events", records.map(row => row.id))).rejects.toThrow("injected last queue failure");
    expect(await db.events.bulkGet(records.map(row => row.id))).toEqual(records);
    expect(await db.syncQueue.count()).toBe(0);
    report("delete rollback", 100, 1, start);
  }, 30_000);

  it("1000-row restore rolls back a late write failure and then restores all rows and queues", async () => {
    const start = performance.now();
    const records = Array.from({ length: 1000 }, (_, i) => event(`restore-${i}`));
    await db.events.bulkPut(records);
    const backup = await createBackup(owner);
    await db.events.clear();
    let writes = 0;
    const fail = () => { if (++writes === 1000) throw new Error("injected last restore failure"); };
    db.events.hook("creating", fail);
    try { await expect(restoreBackup(backup, owner)).rejects.toThrow("injected last restore failure"); }
    finally { db.events.hook("creating").unsubscribe(fail); }
    expect(await db.events.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
    await restoreBackup(backup, owner);
    expect(await db.events.count()).toBe(1000);
    expect(await db.syncQueue.count()).toBe(1000);
    expect(new Set((await db.syncQueue.toArray()).map(row => row.record_id)).size).toBe(1000);
    expect((await db.events.toArray()).every(row => row.version === 2 && row.user_id === owner)).toBe(true);
    report("backup restore rollback and success", 1000, 1, start);
  }, 30_000);

  it.each([1000, 10000])("%i fully overlapping events keep every desktop lane and mobile entry", (count) => {
    const start = performance.now();
    const input: WeekCalendarInput = { dates: weekDates(new Date(2026, 6, 6)), semester: null,
      courses: [], schedules: [], cancellations: [], events: Array.from({ length: count }, (_, i) => event(`layout-${i}`)),
      eventStatusFilter: "all", categories: [], occurrenceStates: [], periods: [] };
    const desktop = buildDesktopWeekLayout(input);
    expect(desktop.overlapLayouts.size).toBe(count);
    expect(new Set([...desktop.overlapLayouts.values()].map(row => row.index)).size).toBe(count);
    expect([...desktop.overlapLayouts.values()].every(row => row.count === count)).toBe(true);
    const mobile = buildMobileWeekLayout(input);
    expect(mobile.entries).toHaveLength(count);
    expect(new Set(mobile.displayGroups.flatMap(group => group.entries.map(row => row.key))).size).toBe(count);
    expect(mobile.displayGroups.every(group => group.top >= 0 && group.top + group.height <= mobile.timelineHeight)).toBe(true);
    report("fully overlapping desktop and mobile layout", count, 1, start);
  }, 30_000);
});
