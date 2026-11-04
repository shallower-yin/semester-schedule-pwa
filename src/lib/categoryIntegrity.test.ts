import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { hardDeleteLocalRecord, hardDeleteLocalRecords } from "./hardDelete";
import { setCurrentUserId } from "./identity";
import { purgeLocalSoftDeletedRecords } from "./sync";

const fields = { user_id: "alice", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  version: 1, deleted_at: null, device_id: "test-device" };
beforeEach(async () => {
  localStorage.clear(); setCurrentUserId("alice");
  await Promise.all([db.events.clear(), db.categories.clear(), db.syncQueue.clear()]);
});
it("purging a soft-deleted category clears the surviving event reference and queues its edit", async () => {
  await db.table("categories").put({ ...fields, id: "category", name: "category", deleted_at: fields.updated_at });
  await db.table("events").put({ ...fields, id: "event", category_id: "category", title: "keep" });
  await purgeLocalSoftDeletedRecords("alice");
  expect(await db.categories.get("category")).toBeUndefined();
  expect(await db.events.get("event")).toMatchObject({ category_id: null, title: "keep", user_id: "alice" });
  expect((await db.syncQueue.toArray()).map(row => `${row.table_name}/${row.operation}`).sort()).toEqual(["categories/delete", "events/upsert"]);
});
it("category delete failure rolls back event unlinking and the queue", async () => {
  const category = { ...fields, id: "category", name: "category" };
  const event = { ...fields, id: "event", category_id: "category", title: "keep" };
  await db.table("categories").put(category);
  await db.table("events").put(event);
  const fail = () => { throw new Error("injected category delete failure"); };
  db.categories.hook("deleting", fail);
  try {
    await expect(hardDeleteLocalRecord("categories", "category")).rejects.toThrow("injected category delete failure");
    expect(await db.events.get("event")).toEqual(event);
    expect(await db.categories.get("category")).toEqual(category);
    expect(await db.syncQueue.count()).toBe(0);
  } finally { db.categories.hook("deleting").unsubscribe(fail); }
});
it.each([false, true])("category hard delete preserves live and soft-deleted events and isolates owners (batch=%s)", async (batch) => {
  await db.table("categories").put({ ...fields, id: "category", name: "category" });
  const rows = [
    { ...fields, id: "live", title: "live", category_id: "category" },
    { ...fields, id: "deleted", title: "deleted", category_id: "category", deleted_at: fields.updated_at },
    { ...fields, user_id: "bob", id: "other", title: "other", category_id: "category" }
  ];
  await db.table("events").bulkPut(rows);
  if (batch) await hardDeleteLocalRecords("categories", ["category", "category"]);
  else await hardDeleteLocalRecord("categories", "category");
  expect(await db.categories.get("category")).toBeUndefined();
  expect(await db.events.get("live")).toMatchObject({ category_id: null, title: "live", user_id: "alice", version: 2 });
  expect(await db.events.get("deleted")).toMatchObject({ category_id: null, deleted_at: fields.updated_at, version: 2 });
  expect(await db.events.get("other")).toEqual(rows[2]);
  expect((await db.syncQueue.toArray()).map(row => `${row.table_name}/${row.operation}`).sort()).toEqual(["categories/delete", "events/upsert", "events/upsert"]);
});
