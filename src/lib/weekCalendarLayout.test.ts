import { describe, expect, it } from "vitest";
import { weekDates } from "./date";
import { buildDesktopWeekLayout, buildMobileGroupLayers, buildMobileWeekLayout, MOBILE_MIN_TITLE_HEIGHT, MOBILE_SLOT_HEIGHT, type WeekCalendarInput } from "./weekCalendarLayout";
import type { ClassPeriod, EventItem } from "../types";

const fields = {
  user_id: "local", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  deleted_at: null, version: 1, device_id: "test-device"
};

function event(id: string, overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...fields, id, event_type: "event", title: id, start_date: "2026-07-06", end_date: "2026-07-06",
    start_time: "08:30", end_time: "09:15", all_day: false, category_id: null, color: "#e36b32", note: "",
    recurrence_type: "none", recurrence_until: null, recurrence_interval: 1,
    reminder_enabled: false, reminder_minutes_before: 10, timezone: "Asia/Shanghai", ...overrides
  };
}

function input(events: EventItem[], overrides: Partial<WeekCalendarInput> = {}): WeekCalendarInput {
  return {
    dates: weekDates(new Date(2026, 6, 6)), semester: null, courses: [], schedules: [], cancellations: [],
    events, eventStatusFilter: "all", categories: [], occurrenceStates: [], periods: [], ...overrides
  };
}

function period(id: string, start: string, end: string, number: number): ClassPeriod {
  return { ...fields, id, semester_id: "semester", weekday: 1, period_number: number, kind: "period",
    sort_order: number, name: id, start_time: start, end_time: end };
}

describe("周视图纯布局", () => {
  it("首尾相接不重叠，真正重叠时复用已经空出的列", () => {
    const adjacent = buildDesktopWeekLayout(input([
      event("first"), event("second", { start_time: "09:15", end_time: "10:00" })
    ]));
    expect(adjacent.overlapLayouts.size).toBe(0);

    const layout = buildDesktopWeekLayout(input([
      event("long", { end_time: "10:00" }), event("first"),
      event("second", { start_time: "09:15", end_time: "10:00" })
    ]));
    expect(layout.overlapLayouts.get("long-2026-07-06")).toEqual({ index: 0, count: 2 });
    expect(layout.overlapLayouts.get("first-2026-07-06")).toEqual({ index: 1, count: 2 });
    expect(layout.overlapLayouts.get("second-2026-07-06")).toEqual({ index: 1, count: 2 });
  });

  it("按发生日期和完成状态筛选，忽略已删和本周以外的事项", () => {
    const data = input([
      event("daily", { recurrence_type: "daily", recurrence_until: "2026-07-07" }),
      event("removed", { deleted_at: "2026-07-05T00:00:00.000Z" }),
      event("outside", { start_date: "2026-07-13", end_date: "2026-07-13" })
    ], {
      eventStatusFilter: "completed",
      occurrenceStates: [{ ...fields, id: "done", event_id: "daily", occurrence_date: "2026-07-07", completed: true, reminder_sent_at: null }]
    });
    const layout = buildMobileWeekLayout(data);
    expect(layout.entries.map((entry) => [entry.key, entry.dayIndex, entry.completed])).toEqual([
      ["daily-2026-07-07", 1, true]
    ]);
    expect(buildDesktopWeekLayout(data).overlapLayouts.size).toBe(0);
  });

  it("保留停课卡片，但停课课程不占桌面重叠列", () => {
    const data = input([event("event")], {
      semester: { ...fields, id: "semester", name: "夏季", start_date: "2026-07-06", total_weeks: 16, is_current: true },
      courses: [{ ...fields, id: "course", semester_id: "semester", name: "课程", teacher: "", classroom: "", color: "#123456", note: "" }],
      schedules: [{ ...fields, id: "schedule", course_id: "course", weekday: 1, start_period: 1, end_period: 1, weeks: [1] }],
      periods: [period("period", "08:30", "09:15", 1)],
      cancellations: [{ ...fields, id: "cancellation", course_schedule_id: "schedule", occurrence_date: "2026-07-06", reason: "" }]
    });
    expect(buildMobileWeekLayout(data).entries.find((entry) => entry.schedule)?.canceled).toBe(true);
    expect(buildDesktopWeekLayout(data).overlapLayouts.size).toBe(0);
    expect(buildDesktopWeekLayout({ ...data, cancellations: [] }).overlapLayouts.get("schedule-2026-07-06")?.count).toBe(2);
  });

  it("全天事项独立于分钟时间线，普通多日事项沿用每天相同时段", () => {
    const data = input([
      event("all-a", { all_day: true, start_time: null, end_time: null }),
      event("all-b", { all_day: true, start_time: null, end_time: null }),
      event("range", { end_date: "2026-07-07" })
    ]);
    const mobile = buildMobileWeekLayout(data);
    expect(mobile.allDayHeight).toBe(104);
    expect(mobile.displayGroups.flatMap((group) => group.entries).every((entry) => !entry.allDay)).toBe(true);
    expect(mobile.entries.filter((entry) => entry.event?.id === "range").map((entry) => [entry.dayIndex, entry.start, entry.end])).toEqual([
      [0, 510, 555], [1, 510, 555]
    ]);
    const desktop = buildDesktopWeekLayout(data);
    expect(desktop.overlapLayouts.get("all-a-2026-07-06")?.count).toBe(2);
    expect(desktop.overlapLayouts.has("range-2026-07-06")).toBe(false);
  });

  it("午夜边界覆盖到24点，末尾卡片不超出时间线", () => {
    const layout = buildMobileWeekLayout(input([
      event("midnight", { start_time: "00:00", end_time: "00:10" }),
      event("late", { start_time: "23:55", end_time: "24:00" })
    ]));
    expect(layout.timeTop(0)).toBe(0);
    expect(layout.timeTop(1440)).toBe(layout.slots.length * MOBILE_SLOT_HEIGHT);
    expect(layout.timelineHeight).toBe(layout.timeTop(1440));
    expect(layout.entries.find((entry) => entry.key === "late-2026-07-06")?.end).toBe(1440);
    for (const group of layout.displayGroups) {
      expect(group.top + group.height).toBeLessThanOrEqual(layout.timelineHeight);
    }
    const lastSlot = layout.slots.at(-1)!;
    expect(layout.entriesForSlot(0, lastSlot.rowIndex).map((entry) => entry.event?.id)).toEqual(["late"]);
  });

  it("层叠卡片按实际起点定位，隐藏项汇总不越过组末", () => {
    const layout = buildMobileWeekLayout(input([
      event("long", { end_time: "10:00" }),
      event("short-a", { start_time: "09:55", end_time: "10:00" }),
      event("short-b", { start_time: "09:56", end_time: "10:00" })
    ], { periods: [period("first", "08:30", "09:15", 1), period("second", "09:15", "10:00", 2)] }));
    const group = layout.displayGroups[0];
    const layers = buildMobileGroupLayers(group, layout.timeTop);
    expect(layers.layered).toBe(true);
    expect(layers.base.event?.id).toBe("long");
    expect(layers.hiddenFronts).toHaveLength(2);
    expect(layers.summaryTop).toBeCloseTo(layout.timeTop(595) - group.top);
    expect(layers.summaryTop + layers.summaryHeight).toBeLessThanOrEqual(group.height);
    for (const entry of group.entries) {
      const placement = layers.entryPlacement(entry);
      expect(placement.top).toBeCloseTo(layout.timeTop(entry.start) - group.top);
      expect(placement.top + placement.height).toBeLessThanOrEqual(group.height);
    }
  });

  it("手机普通短事项仍使用原高度并保留时段边界", () => {
    const layout = buildMobileWeekLayout(input([
      event("short", { start_time: "09:55", end_time: "10:05" })
    ], { periods: [period("first", "08:30", "09:15", 1), period("second", "09:20", "10:05", 2)] }));
    const group = layout.displayGroups[0];
    expect(group.top).toBe(layout.timeTop(595));
    expect(group.height).toBeCloseTo(MOBILE_SLOT_HEIGHT * 10 / 45);
    expect(group.top + group.height).toBeCloseTo(layout.timeTop(605));
    expect(layout.slots.every((row) => layout.timeTop(row.end) <= layout.timelineHeight)).toBe(true);
  });

  it("手机相邻短事项沿用原分组，不因桌面高度调整合并下一节", () => {
    const layout = buildMobileWeekLayout(input([
      event("first", { end_time: "08:40" }),
      event("second", { start_time: "08:40", end_time: "08:50" }),
      event("third", { start_time: "09:20", end_time: "09:30" })
    ]));
    expect(layout.displayGroups).toHaveLength(2);
    expect(layout.displayGroups.map((group) => group.entries.length)).toEqual([2, 1]);
    expect(layout.displayGroups[0].top + layout.displayGroups[0].height).toBeLessThanOrEqual(layout.displayGroups[1].top);
  });

  it.each(["23:40", "23:59"])("深夜%s的事项至少保留一行标题且不越过午夜边界", (start) => {
    const layout = buildMobileWeekLayout(input([event("late", { start_time: start, end_time: "24:00" })]));
    const group = layout.displayGroups[0];
    expect(group.height).toBeGreaterThanOrEqual(MOBILE_MIN_TITLE_HEIGHT);
    expect(group.top).toBe(layout.timelineHeight - MOBILE_MIN_TITLE_HEIGHT);
    expect(group.top + group.height).toBeLessThanOrEqual(layout.timelineHeight);
    expect(group.entries[0].time).toBe(`${start}–24:00`);
  });

  it("深夜重叠组内的靠下事项与汇总也保留一行标题", () => {
    const layout = buildMobileWeekLayout(input([
      event("long", { start_time: "20:10", end_time: "24:00" }),
      event("late-a", { start_time: "23:40", end_time: "24:00" }),
      event("late-b", { start_time: "23:59", end_time: "24:00" })
    ]));
    const group = layout.displayGroups.at(-1)!;
    const layers = buildMobileGroupLayers(group, layout.timeTop);
    for (const entry of group.entries.filter((entry) => entry.start >= 1420)) {
      const placement = layers.entryPlacement(entry);
      expect(placement.height).toBeGreaterThanOrEqual(MOBILE_MIN_TITLE_HEIGHT);
      expect(group.top + placement.top + placement.height).toBeLessThanOrEqual(layout.timelineHeight);
    }
    if (layers.hiddenFronts.length) expect(layers.summaryHeight).toBeGreaterThanOrEqual(MOBILE_MIN_TITLE_HEIGHT);
  });
});
