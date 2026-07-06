import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { EventOccurrenceState } from "../types";
import { deduplicateLocalOccurrenceStates, newestOccurrenceState } from "./occurrenceStates";

const userId = "22222222-2222-4222-8222-222222222222";

function state(id: string, updatedAt: string): EventOccurrenceState {
  return {
    id,
    user_id: userId,
    created_at: "2026-07-06T04:00:00.000Z",
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    event_id: "55555555-5555-4555-8555-555555555555",
    occurrence_date: "2026-07-06",
    completed: false,
    reminder_sent_at: null
  };
}

describe("事项状态自然键去重", () => {
  beforeEach(async () => {
    await db.eventOccurrenceStates.clear();
    await db.syncQueue.clear();
  });

  it("保留最后修改的记录", () => {
    const older = state("33333333-3333-4333-8333-333333333333", "2026-07-06T04:01:00.000Z");
    const newer = state("44444444-4444-4444-8444-444444444444", "2026-07-06T04:02:00.000Z");
    expect(newestOccurrenceState([older, newer])).toEqual(newer);
  });

  it("删除同一事项日期的旧 ID 及其待上传项", async () => {
    const older = state("33333333-3333-4333-8333-333333333333", "2026-07-06T04:01:00.000Z");
    const newer = state("44444444-4444-4444-8444-444444444444", "2026-07-06T04:02:00.000Z");
    await db.eventOccurrenceStates.bulkPut([older, newer]);
    await db.syncQueue.put({
      id: "66666666-6666-4666-8666-666666666666",
      table_name: "eventOccurrenceStates",
      record_id: older.id,
      operation: "upsert",
      queued_at: "2026-07-06T04:03:00.000Z",
      attempts: 1,
      last_error: "duplicate"
    });

    expect(await deduplicateLocalOccurrenceStates(userId)).toBe(1);
    expect(await db.eventOccurrenceStates.toArray()).toEqual([newer]);
    expect(await db.syncQueue.count()).toBe(0);
  });
});
