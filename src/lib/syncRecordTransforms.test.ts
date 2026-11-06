import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncTableName } from "../types";
import { gregorianDateForLunarDate, lunarOccurrenceDates, lunarYearEndOccurrenceDates } from "./lunarCalendar";
import { normalizeRemoteRecord, normalizeUploadPayload } from "./syncRecordTransforms";

vi.mock("./supabase", () => ({ supabase: null }));
vi.mock("./lunarCalendar", () => ({
  lunarOccurrenceDates: vi.fn(() => ["2026-02-17"]),
  gregorianDateForLunarDate: vi.fn(() => "2026-02-17"),
  lunarYearEndDate: vi.fn(() => "2027-02-05"),
  lunarYearEndOccurrenceDates: vi.fn(() => ["2027-02-05", "2028-01-25"]),
  qingmingDateForYear: vi.fn(() => "2028-04-04"),
  lunarDateParts: vi.fn(() => ({ relatedYear: 2026, month: 12, day: 29, isLeapMonth: false }))
}));

const syncTables = [
  "semesters", "classPeriods", "courses", "courseSchedules", "courseCancellations",
  "categories", "events", "eventOccurrenceStates", "anniversaries", "memoFolders",
  "memos", "todos", "focusSettings", "focusSessions", "restSessions", "healthProfiles", "healthLogs"
] satisfies SyncTableName[];

interface TransformCase {
  table: SyncTableName;
  input?: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const remoteDefaults: TransformCase[] = [
  {
    table: "classPeriods", input: { start_time: "08:30:00", end_time: "09:15:00", period_number: "2" },
    expected: { kind: "period", sort_order: 2, start_time: "08:30", end_time: "09:15", period_number: "2" }
  },
  {
    table: "events",
    expected: {
      event_type: "event", start_time: null, end_time: null, location: "", reminder_enabled: false,
      reminder_minutes_before: 10, recurrence_interval: 1, timezone: "Asia/Shanghai"
    }
  },
  { table: "eventOccurrenceStates", expected: { reminder_sent_at: null } },
  {
    table: "anniversaries",
    expected: {
      kind: "anniversary", calendar_type: "solar", lunar_year: null, lunar_month: null, lunar_day: null,
      lunar_is_leap_month: false, lunar_occurrence_dates: [], color: "#d97706", note: "",
      reminder_enabled: false, reminder_days_before: 0, reminder_time: "09:00",
      reminder_sent_for: null, timezone: "Asia/Shanghai"
    }
  },
  { table: "memos", expected: { folder_id: null, is_pinned: false, images: [] } },
  {
    table: "todos",
    expected: {
      title: "", color: "#cfeeff", sort_order: 0, is_pinned: false, completed_at: null,
      reminder_enabled: false, reminder_at: null, reminder_sent_at: null
    }
  },
  {
    table: "healthProfiles",
    expected: {
      height_cm: null, daily_water_goal_ml: 2000, exercise_items: ["俯卧撑", "仰卧起坐", "深蹲"],
      movement_reminder_enabled: false, movement_interval_minutes: 60,
      reminder_start_time: "09:00", reminder_end_time: "22:00", last_movement_reminder_at: null
    }
  },
  { table: "healthLogs", expected: { amount: 0, activity: null, note: "" } },
  {
    table: "focusSettings",
    expected: {
      pomodoro_minutes: 25, pomodoro_rounds: 4, short_break_minutes: 5, long_break_minutes: 15,
      long_break_interval: 4, auto_start_break: true, countdown_minutes: 30,
      daily_goal_minutes: 120, sound_enabled: false
    }
  },
  {
    table: "focusSessions",
    expected: {
      linked_event_id: null, planned_seconds: null, duration_seconds: 0, completed: false,
      interrupted: false, pomodoro_plan_id: null, pomodoro_round: null
    }
  },
  {
    table: "restSessions",
    expected: {
      planned_seconds: 0, duration_seconds: 0, completed: false, interrupted: false,
      rest_kind: "manual", pomodoro_plan_id: null, pomodoro_round: null
    }
  }
];

beforeEach(() => vi.clearAllMocks());

describe("同步记录下载转换", () => {
  it.each(remoteDefaults)("保留 $table 的默认字段契约", ({ table, input = {}, expected }) => {
    const record = { id: "record-1", user_id: "owner-1", custom: "preserved", ...input };
    expect(normalizeRemoteRecord(table, record)).toEqual({
      id: "record-1", user_id: "owner-1", custom: "preserved", ...expected
    });
  });

  it.each<SyncTableName>([
    "semesters", "categories", "courses", "courseSchedules", "courseCancellations", "memoFolders"
  ])("未定义下载转换的 %s 保持原对象", (table) => {
    const record = { id: "record-1", nullable: null, server_updated_at: "2026-01-01T00:00:00Z" };
    expect(normalizeRemoteRecord(table, record)).toBe(record);
  });

  it("时间块、事项和专注设置保留显式零值、false及已有值", () => {
    expect(normalizeRemoteRecord("classPeriods", {
      kind: "break", sort_order: 0, period_number: 3, start_time: "08:30:00", end_time: "09:00:00"
    })).toMatchObject({ kind: "break", sort_order: 0, start_time: "08:30", end_time: "09:00" });
    expect(normalizeRemoteRecord("events", {
      event_type: "habit", start_time: "08:30:00", end_time: "", reminder_minutes_before: 0,
      recurrence_interval: 0, reminder_enabled: false, timezone: "UTC"
    })).toMatchObject({
      event_type: "habit", start_time: "08:30", end_time: null, reminder_minutes_before: 0,
      recurrence_interval: 0, reminder_enabled: false, timezone: "Asia/Shanghai"
    });
    expect(normalizeRemoteRecord("focusSettings", { auto_start_break: false, pomodoro_minutes: 0 }))
      .toMatchObject({ auto_start_break: false, pomodoro_minutes: 0 });
    expect(normalizeRemoteRecord("focusSettings", { auto_start_break: null }))
      .toMatchObject({ auto_start_break: true });
  });

  it("纪念日下载转换农历数字并过滤日期格式，不生成日期", () => {
    expect(normalizeRemoteRecord("anniversaries", {
      calendar_type: "lunar", lunar_year: "2026", lunar_month: "1", lunar_day: "1",
      lunar_is_leap_month: false, lunar_occurrence_dates: ["2026-02-17", "bad", 2026, null],
      reminder_time: "09:15:00", reminder_days_before: 0, timezone: "UTC"
    })).toMatchObject({
      calendar_type: "lunar", lunar_year: 2026, lunar_month: 1, lunar_day: 1,
      lunar_is_leap_month: false, lunar_occurrence_dates: ["2026-02-17"],
      reminder_time: "09:15", reminder_days_before: 0, timezone: "Asia/Shanghai"
    });
    expect(lunarOccurrenceDates).not.toHaveBeenCalled();
  });

  it("备忘录沿用图片规范化，而上传不额外规范化图片", () => {
    const record = { images: [null, { path: " image.jpg ", size: "12" }, { path: " " }] };
    expect(normalizeRemoteRecord("memos", record)).toEqual({
      folder_id: null, is_pinned: false,
      images: [{ id: "image.jpg", name: "备忘录图片", path: "image.jpg", mime_type: "image/jpeg", size: 12 }]
    });
    expect(normalizeUploadPayload("memos", record)).toEqual(record);
  });
});

describe("同步记录上传转换", () => {
  it.each(syncTables)("%s 去掉服务端时间戳并保留记录身份，不修改原对象", (table) => {
    const record = Object.freeze({
      id: "record-1", user_id: "owner-1", version: 2,
      updated_at: "2026-01-01T00:00:00Z", server_updated_at: "2026-01-02T00:00:00Z"
    });
    const result = normalizeUploadPayload(table, record);
    expect(result).toMatchObject({
      id: "record-1", user_id: "owner-1", version: 2, updated_at: "2026-01-01T00:00:00Z"
    });
    expect(result).not.toHaveProperty("server_updated_at");
    expect(record.server_updated_at).toBe("2026-01-02T00:00:00Z");
    expect(result).not.toBe(record);
  });

  it.each<SyncTableName>(["events", "anniversaries"])("%s 上传只强制时区，不套用下载默认字段", (table) => {
    expect(normalizeUploadPayload(table, { id: "record-1", timezone: "UTC" }))
      .toEqual({ id: "record-1", timezone: "Asia/Shanghai" });
  });

  it("上传时从完整农历年月日生成公历日期和提醒日期清单", () => {
    const record = { calendar_type: "lunar", lunar_year: 2026, lunar_month: 1, lunar_day: 1, lunar_is_leap_month: true };
    expect(normalizeUploadPayload("anniversaries", record)).toMatchObject({
      date: "2026-02-17", timezone: "Asia/Shanghai", lunar_occurrence_dates: ["2026-02-17"]
    });
    expect(lunarOccurrenceDates).toHaveBeenCalledExactlyOnceWith(2026, 1, 1, true);
  });

  it("已存在的错误公历日期及非空提醒清单也会按农历原日期重算", () => {
    const record = { calendar_type: "lunar", lunar_year: 2026, lunar_month: 1, lunar_day: 1 };
    const dates = ["2030-02-03"];
    expect(normalizeUploadPayload("anniversaries", {
      ...record, date: "2026-01-01", lunar_occurrence_dates: dates, reminder_sent_for: "2026-01-01"
    })).toMatchObject({ date: "2026-02-17", lunar_occurrence_dates: ["2026-02-17"], reminder_sent_for: null });
    expect(dates).toEqual(["2030-02-03"]);
    expect(lunarOccurrenceDates).toHaveBeenCalledExactlyOnceWith(2026, 1, 1, false);
  });

  it("拒绝上传缺失或无效的农历日期，避免默默保存成公历", () => {
    const record = { calendar_type: "lunar", lunar_year: 2026, lunar_month: 1, lunar_day: 1 };
    expect(() => normalizeUploadPayload("anniversaries", { ...record, lunar_year: "2026" })).toThrow("年月日");
    expect(() => normalizeUploadPayload("anniversaries", { ...record, lunar_day: null })).toThrow("年月日");
    vi.mocked(gregorianDateForLunarDate).mockReturnValueOnce(null);
    expect(() => normalizeUploadPayload("anniversaries", { ...record, lunar_month: 13 })).toThrow("日期不存在");
    expect(lunarOccurrenceDates).not.toHaveBeenCalled();
  });

  it("除夕上传覆盖大小月年末日期，普通腊月生日不套用除夕规则", () => {
    const record = { calendar_type: "lunar", lunar_year: 2026, lunar_month: 12, lunar_day: 30 };
    expect(normalizeUploadPayload("anniversaries", { ...record, kind: "holiday", title: "除夕" }))
      .toMatchObject({ date: "2027-02-05", lunar_month: 12, lunar_day: 29, lunar_is_leap_month: false,
        lunar_occurrence_dates: ["2027-02-05", "2028-01-25"] });
    expect(lunarYearEndOccurrenceDates).toHaveBeenCalledExactlyOnceWith(2026);
    expect(lunarOccurrenceDates).not.toHaveBeenCalled();
    normalizeUploadPayload("anniversaries", { ...record, kind: "birthday", title: "生日" });
    expect(lunarOccurrenceDates).toHaveBeenCalledExactlyOnceWith(2026, 12, 30, false);
  });

  it("误标成农历的清明上传时恢复节气日期和公历历法，不套用农历月日", () => {
    expect(normalizeUploadPayload("anniversaries", { kind: "holiday", title: "清明节", date: "2028-04-05",
      calendar_type: "lunar", lunar_year: 2028, lunar_month: 2, lunar_day: 18, lunar_occurrence_dates: ["2028-04-05"] }))
      .toMatchObject({ date: "2028-04-04", calendar_type: "solar", lunar_year: null, lunar_month: null, lunar_day: null,
        lunar_occurrence_dates: [], reminder_sent_for: null });
    expect(lunarOccurrenceDates).not.toHaveBeenCalled();
  });

  it("专注模式仅在上传时规范化，并保留四种有效模式", () => {
    expect(normalizeRemoteRecord("focusSessions", { mode: "legacy" })).toMatchObject({ mode: "legacy" });
    expect(normalizeUploadPayload("focusSessions", { mode: "legacy", task_title: null }))
      .toMatchObject({ mode: "pomodoro", task_title: "", planned_seconds: null, linked_event_id: null });
    for (const mode of ["stopwatch", "countdown", "pomodoro", "lock"]) {
      expect(normalizeUploadPayload("focusSessions", { mode, planned_seconds: 0, pomodoro_round: 0 }))
        .toMatchObject({ mode, planned_seconds: 0, pomodoro_round: 0 });
    }
  });

  it("休息类型仅在上传时限制有效值，不与下载转换合并", () => {
    expect(normalizeRemoteRecord("restSessions", { rest_kind: "legacy", duration_seconds: "12" }))
      .toMatchObject({ rest_kind: "legacy", duration_seconds: 12 });
    expect(normalizeUploadPayload("restSessions", { rest_kind: "legacy", planned_seconds: null }))
      .toMatchObject({ rest_kind: "manual", planned_seconds: 0 });
    for (const rest_kind of ["pomodoro_short", "pomodoro_long"]) {
      expect(normalizeUploadPayload("restSessions", { rest_kind })).toMatchObject({ rest_kind });
    }
  });
});

describe("同步双向转换的共享字段与非对称规则", () => {
  it("待办只在上传时去掉标题两端空白，两向规范化颜色和带时区提醒", () => {
    const record = {
      title: "  阅读  ", color: " #ABCdef ", sort_order: "4", reminder_enabled: true,
      reminder_at: "2026-11-04T09:30:00+08:00", reminder_sent_at: "not-a-date", completed_at: null
    };
    const common = {
      color: "#ABCdef", sort_order: 4, reminder_enabled: true,
      reminder_at: "2026-11-04T01:30:00.000Z", reminder_sent_at: null, completed_at: null
    };
    expect(normalizeRemoteRecord("todos", record)).toMatchObject({ ...common, title: "  阅读  " });
    expect(normalizeUploadPayload("todos", record)).toMatchObject({ ...common, title: "阅读" });
    for (const convert of [normalizeRemoteRecord, normalizeUploadPayload]) {
      expect(convert("todos", { color: "#abc", reminder_at: " ", reminder_sent_at: 123 }))
        .toMatchObject({ color: "#cfeeff", reminder_at: null, reminder_sent_at: null });
    }
  });

  it("健康字段保留零值、规范化项目并在去重前限制十二项", () => {
    for (const convert of [normalizeRemoteRecord, normalizeUploadPayload]) {
      expect(convert("healthProfiles", {
        height_cm: "170", daily_water_goal_ml: 0, movement_interval_minutes: 0,
        movement_reminder_enabled: false, exercise_items: [" 深蹲 ", "", "深蹲", "跑步"],
        reminder_start_time: "08:30:00", reminder_end_time: "20:00:00"
      })).toMatchObject({
        height_cm: 170, daily_water_goal_ml: 0, movement_interval_minutes: 0,
        movement_reminder_enabled: false, exercise_items: ["深蹲", "跑步"],
        reminder_start_time: "08:30", reminder_end_time: "20:00"
      });
      expect(convert("healthProfiles", { exercise_items: [" "] })).toHaveProperty(
        "exercise_items", ["俯卧撑", "仰卧起坐", "深蹲"]
      );
      expect(convert("healthProfiles", { exercise_items: [...Array(12).fill("深蹲"), "跑步"] }))
        .toHaveProperty("exercise_items", ["深蹲"]);
    }
  });

  it.each<SyncTableName>(["healthProfiles", "todos", "focusSessions", "restSessions"])(
    "%s 已规范化上传记录再次下载和上传保持稳定",
    (table) => {
      const canonical = normalizeUploadPayload(table, {
        id: "record-1", user_id: "owner-1", title: "  阅读  ", server_updated_at: "server-time"
      });
      const downloaded = normalizeRemoteRecord(table, canonical);
      expect(normalizeUploadPayload(table, downloaded)).toEqual(canonical);
    }
  );

  it("下载转换也不修改原始对象和嵌套数组", () => {
    const dates = Object.freeze(["2026-02-17", "bad"]);
    const record = Object.freeze({ calendar_type: "lunar", lunar_year: "2026", lunar_occurrence_dates: dates });
    expect(normalizeRemoteRecord("anniversaries", record)).toHaveProperty("lunar_occurrence_dates", ["2026-02-17"]);
    expect(record.lunar_year).toBe("2026");
    expect(dates).toEqual(["2026-02-17", "bad"]);
  });
});
