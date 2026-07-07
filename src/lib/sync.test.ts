import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { getSyncHealth } from "./sync";

describe("同步健康检查", () => {
  beforeEach(async () => {
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
});
