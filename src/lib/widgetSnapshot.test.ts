import { describe, expect, it } from "vitest";
import type { EventItem, TodoItem } from "../types";
import { dateAtProductTime } from "./date";
import { buildWidgetSnapshot } from "./widgetSnapshot";

const baseFields = {
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  deleted_at: null,
  version: 1,
  device_id: "test-device"
};

function event(overrides: Partial<EventItem>): EventItem {
  return {
    ...baseFields,
    id: "event",
    user_id: "alice",
    event_type: "event",
    title: "事项",
    start_date: "2026-08-30",
    start_time: "09:00",
    end_date: "2026-08-30",
    end_time: "10:00",
    all_day: false,
    category_id: null,
    color: "#e36b32",
    note: "不要写入小组件",
    recurrence_type: "none",
    recurrence_until: null,
    recurrence_interval: 1,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}

function todo(overrides: Partial<TodoItem>): TodoItem {
  return {
    ...baseFields,
    id: "todo",
    user_id: "alice",
    title: "待办",
    color: "#3157d5",
    sort_order: 0,
    is_pinned: false,
    completed_at: null,
    ...overrides
  };
}

const emptyInput = {
  semester: null,
  courses: [],
  schedules: [],
  cancellations: [],
  categories: [],
  occurrenceStates: [],
  periods: [],
  focusSessions: []
};

describe("Android 小组件日程快照", () => {
  it("按北京时间生成连续七天，并保留跨午夜缓存有效期", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [event({ id: "daily", title: "每天复习", recurrence_type: "daily", recurrence_until: "2026-09-02" })]
    }, dateAtProductTime("2026-08-30", "23:50"));

    expect(snapshot.days).toHaveLength(7);
    expect(snapshot.days.map((day) => day.date)).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"
    ]);
    expect(snapshot.days.slice(0, 4).every((day) => day.items[0]?.title === "每天复习")).toBe(true);
    expect(snapshot.days[0].items[0]).toMatchObject({
      key: "event:daily:2026-08-30",
      startMinute: 540,
      endMinute: 600,
      allDay: false,
      color: "#e36b32"
    });
    expect(snapshot.validUntil).toBe("2026-09-05T16:00:00.000Z");
  });

  it("不会把其他账号的课程或事项写入快照，也不携带备注", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [
        event({ id: "mine", title: "我的事项" }),
        event({ id: "other", user_id: "bob", title: "别人的事项" })
      ]
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(snapshot.days[0].items.map((item) => item.title)).toEqual(["我的事项"]);
    expect(JSON.stringify(snapshot)).not.toContain("不要写入小组件");
    expect(JSON.stringify(snapshot)).not.toContain("bob");
  });

  it("限制条数、标题长度，并正确处理全天事项", () => {
    const events = Array.from({ length: 4 }, (_, index) => event({
      id: `event-${index}`,
      title: `${"很长的标题".repeat(30)}${index}`,
      start_time: null,
      end_time: null,
      all_day: true
    }));
    const snapshot = buildWidgetSnapshot({ ...emptyInput, ownerId: "alice", events }, dateAtProductTime("2026-08-30", "08:00"), {
      days: 1,
      maxItemsPerDay: 2
    });

    expect(snapshot.days[0].items).toHaveLength(2);
    expect(snapshot.days[0].items[0].title.length).toBeLessThanOrEqual(80);
    expect(snapshot.days[0].items[0]).toMatchObject({ allDay: true, startMinute: null, endMinute: null });
  });

  it("按 Unicode 字符而不是 UTF-16 单元截断 emoji 标题", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [event({ id: "emoji", title: "📚".repeat(100) })]
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    const title = snapshot.days[0].items[0].title;
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("只有开始时间时不会伪造相同的结束时间", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [event({ id: "start-only", start_time: "09:00", end_time: null })]
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(snapshot.days[0].items[0]).toMatchObject({ startMinute: 540, endMinute: null });
  });

  it("保持 schema 1，并在调用方没有提供待办时省略可选字段", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: []
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(snapshot.schema).toBe(1);
    expect(Object.hasOwn(snapshot, "todos")).toBe(false);
  });

  it("待办按账号隔离，仅投影未完成项，并按置顶、顺序和创建时间取前三条", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [],
      todos: [
        todo({ id: "normal-later", title: "普通稍后", sort_order: 1, created_at: "2026-08-03T00:00:00.000Z" }),
        todo({ id: "pinned-later", title: "置顶稍后", is_pinned: true, sort_order: 8 }),
        todo({ id: "normal-first", title: "普通第一", sort_order: 1, created_at: "2026-08-02T00:00:00.000Z" }),
        todo({ id: "pinned-first", title: "置顶第一", is_pinned: true, sort_order: 1 }),
        todo({ id: "done", title: "已完成", completed_at: "2026-08-03T00:00:00.000Z" }),
        todo({ id: "deleted", title: "已删除", deleted_at: "2026-08-03T00:00:00.000Z" }),
        todo({ id: "other", user_id: "bob", title: "其他账号" })
      ]
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(snapshot.todos).toEqual([
      { title: "置顶第一", targetId: "pinned-first" },
      { title: "置顶稍后", targetId: "pinned-later" },
      { title: "普通第一", targetId: "normal-first" }
    ]);
    expect(Object.keys(snapshot.todos![0])).toEqual(["title", "targetId"]);
    expect(JSON.stringify(snapshot)).not.toContain("bob");
    expect(JSON.stringify(snapshot)).not.toContain("已完成");
    expect(JSON.stringify(snapshot)).not.toContain("已删除");
  });

  it("待办空列表仍会发布，从而让新版插件区分已清空与缓存缺失", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [],
      todos: []
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(Object.hasOwn(snapshot, "todos")).toBe(true);
    expect(snapshot.todos).toEqual([]);
  });

  it("已完成日程不再投影到组件，未完成日程仍带有可完成目标", () => {
    const snapshot = buildWidgetSnapshot({
      ...emptyInput,
      ownerId: "alice",
      events: [
        event({ id: "done", title: "已经完成", completed_at: "2026-08-30T01:00:00.000Z" }),
        event({ id: "open", title: "尚未完成" })
      ],
      todos: []
    }, dateAtProductTime("2026-08-30", "08:00"), { days: 1 });

    expect(snapshot.days[0].items).toEqual([
      expect.objectContaining({ kind: "event", targetId: "open", completed: false })
    ]);
  });
});
