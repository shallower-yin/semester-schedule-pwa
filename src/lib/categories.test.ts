import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { Category, EventItem } from "../types";
import { deduplicateCategories, uniqueCategoriesByName } from "./categories";
import { setCurrentUserId } from "./identity";

const userId = "22222222-2222-4222-8222-222222222222";

function category(id: string, createdAt: string): Category {
  return {
    id,
    user_id: userId,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    name: "学习",
    color: "#4f6bdc",
    icon: "book-open"
  };
}

function eventItem(categoryId: string): EventItem {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    user_id: userId,
    created_at: "2026-01-03T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "11111111-1111-4111-8111-111111111111",
    title: "复习",
    start_date: "2026-07-05",
    start_time: "09:00",
    end_date: "2026-07-05",
    end_time: "10:00",
    all_day: false,
    category_id: categoryId,
    color: "#4f6bdc",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai"
  };
}

describe("分类去重", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId(userId);
    await db.categories.clear();
    await db.events.clear();
    await db.syncQueue.clear();
  });

  it("下拉框按名称只显示一次", () => {
    const first = category("33333333-3333-4333-8333-333333333333", "2026-01-01T00:00:00.000Z");
    const second = category("44444444-4444-4444-8444-444444444444", "2026-01-02T00:00:00.000Z");
    expect(uniqueCategoriesByName([first, second])).toEqual([first]);
  });

  it("合并重复分类并迁移已有事项关联", async () => {
    const keeper = category("33333333-3333-4333-8333-333333333333", "2026-01-01T00:00:00.000Z");
    const duplicate = category("44444444-4444-4444-8444-444444444444", "2026-01-02T00:00:00.000Z");
    await db.categories.bulkPut([keeper, duplicate]);
    await db.events.put(eventItem(duplicate.id));

    expect(await deduplicateCategories(userId)).toBe(1);
    expect((await db.events.get("55555555-5555-4555-8555-555555555555"))?.category_id).toBe(keeper.id);
    expect((await db.categories.get(duplicate.id))?.deleted_at).not.toBeNull();
    expect(await db.syncQueue.count()).toBe(2);
  });
});
