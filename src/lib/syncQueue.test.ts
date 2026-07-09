import { beforeEach, describe, expect, it } from "vitest";
import { db, queueChange } from "../db";
import type { EventItem, SyncFields } from "../types";
import { hardDeleteLocalRecord } from "./hardDelete";
import { setCurrentUserId } from "./identity";

const userId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-01-01T00:00:00.000Z";

function fields(id: string): SyncFields {
  return {
    id,
    user_id: userId,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111"
  };
}

function eventRecord(id: string): EventItem {
  return {
    ...fields(id),
    event_type: "event",
    title: "pending event",
    start_date: "2026-07-09",
    start_time: "09:00",
    end_date: "2026-07-09",
    end_time: "09:00",
    all_day: false,
    category_id: null,
    color: "#3157d5",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    recurrence_interval: 1,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai"
  };
}

describe("sync queue compaction", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId(userId);
    await db.events.clear();
    await db.syncQueue.clear();
  });

  it("keeps only the latest operation for one record", async () => {
    const eventItem = eventRecord("event-pending");
    await db.events.put(eventItem);
    await queueChange("events", eventItem.id, "upsert");

    await hardDeleteLocalRecord("events", eventItem.id);

    const queued = await db.syncQueue.where("record_id").equals(eventItem.id).toArray();
    expect(await db.events.get(eventItem.id)).toBeUndefined();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      table_name: "events",
      record_id: eventItem.id,
      operation: "delete",
      attempts: 0,
      last_error: null
    });
  });

  it("removes duplicate queued rows for the same record", async () => {
    await db.syncQueue.bulkPut([
      { id: "queue-1", table_name: "events", record_id: "event-1", operation: "upsert", queued_at: "2026-07-09T08:00:00.000Z", attempts: 2, last_error: "old" },
      { id: "queue-2", table_name: "events", record_id: "event-1", operation: "upsert", queued_at: "2026-07-09T08:01:00.000Z", attempts: 1, last_error: "old" }
    ]);

    await queueChange("events", "event-1", "delete");

    const queued = await db.syncQueue.where("record_id").equals("event-1").toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ table_name: "events", record_id: "event-1", operation: "delete", attempts: 0, last_error: null });
  });
});
