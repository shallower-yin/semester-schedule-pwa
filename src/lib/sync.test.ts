import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { EventItem, EventOccurrenceState, FocusSession, Memo, MemoFolder, SyncFields } from "../types";
import { getSyncHealth, purgeLocalSoftDeletedRecords } from "./sync";

describe("同步健康检查", () => {
  beforeEach(async () => {
    await db.events.clear();
    await db.eventOccurrenceStates.clear();
    await db.focusSessions.clear();
    await db.memoFolders.clear();
    await db.memos.clear();
    await db.syncQueue.clear();
  });

  it("按数据表汇总待上传和失败信息", async () => {
    await db.syncQueue.bulkPut([
      {
        id: "11111111-1111-4111-8111-111111111111",
        table_name: "events",
        record_id: "event-1",
        operation: "upsert",
        queued_at: "2026-07-07T08:00:00.000Z",
        attempts: 0,
        last_error: null
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        table_name: "events",
        record_id: "event-2",
        operation: "upsert",
        queued_at: "2026-07-07T08:01:00.000Z",
        attempts: 2,
        last_error: "网络失败"
      }
    ]);

    const health = await getSyncHealth();

    expect(health.pending).toBe(2);
    expect(health.failed).toBe(1);
    expect(health.oldest_queued_at).toBe("2026-07-07T08:00:00.000Z");
    expect(health.tables).toEqual([
      expect.objectContaining({
        table_name: "events",
        label: "事项",
        pending: 2,
        failed: 1,
        attempts: 2,
        last_error: "网络失败"
      })
    ]);
  });

  it("同步前把历史软删除事项转为硬删除并解除专注记录关联", async () => {
    const eventItem: EventItem = {
      ...fields("event-legacy"),
      deleted_at: "2026-07-09T08:00:00.000Z",
      event_type: "event",
      title: "旧事项",
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
    const state: EventOccurrenceState = {
      ...fields("state-legacy"),
      event_id: eventItem.id,
      occurrence_date: "2026-07-09",
      completed: true,
      reminder_sent_at: null
    };
    const focusSession: FocusSession = {
      ...fields("focus-active"),
      mode: "pomodoro",
      task_title: "旧事项",
      linked_event_id: eventItem.id,
      planned_seconds: 1500,
      duration_seconds: 1500,
      started_at: "2026-07-09T08:00:00.000Z",
      ended_at: "2026-07-09T08:25:00.000Z",
      completed: true,
      interrupted: false
    };
    await db.events.put(eventItem);
    await db.eventOccurrenceStates.put(state);
    await db.focusSessions.put(focusSession);

    const purged = await purgeLocalSoftDeletedRecords(USER_ID);

    expect(purged).toBe(2);
    expect(await db.events.get(eventItem.id)).toBeUndefined();
    expect(await db.eventOccurrenceStates.get(state.id)).toBeUndefined();
    expect((await db.focusSessions.get(focusSession.id))?.linked_event_id).toBeNull();
    expect((await db.syncQueue.toArray()).map((item) => `${item.table_name}:${item.record_id}:${item.operation}`).sort()).toEqual([
      "eventOccurrenceStates:state-legacy:delete",
      "events:event-legacy:delete",
      "focusSessions:focus-active:upsert"
    ]);
  });

  it("同步前硬删除历史软删除文件夹，并保留文件夹内备忘录", async () => {
    const folder: MemoFolder = {
      ...fields("folder-legacy"),
      deleted_at: "2026-07-09T08:00:00.000Z",
      name: "旧文件夹",
      sort_order: 1
    };
    const memo: Memo = {
      ...fields("memo-active"),
      folder_id: folder.id,
      title: "保留备忘录",
      content: "内容",
      is_pinned: false
    };
    await db.memoFolders.put(folder);
    await db.memos.put(memo);

    const purged = await purgeLocalSoftDeletedRecords(USER_ID);

    expect(purged).toBe(1);
    expect(await db.memoFolders.get(folder.id)).toBeUndefined();
    expect((await db.memos.get(memo.id))?.folder_id).toBeNull();
    expect((await db.syncQueue.toArray()).map((item) => `${item.table_name}:${item.record_id}:${item.operation}`).sort()).toEqual([
      "memoFolders:folder-legacy:delete",
      "memos:memo-active:upsert"
    ]);
  });
});

const USER_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function fields(id: string): SyncFields {
  return {
    id,
    user_id: USER_ID,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111"
  };
}
