import { describe, expect, it } from "vitest";
import { recoverLunarAnniversary } from "./syncRecordTransforms";

describe("有原始历法依据的旧纪念日恢复", () => {
  it("按节日名称和农历备注恢复旧公历记录，不再次转换错误公历月日", () => {
    const original = { id: "holiday", kind: "holiday", title: "中秋节", date: "2026-10-27", calendar_type: "solar",
      note: "农历八月十五", reminder_enabled: true, reminder_sent_for: "2026-10-27" };
    const repaired = recoverLunarAnniversary(original)!;
    expect(repaired).toMatchObject({ id: "holiday", date: "2026-09-25", calendar_type: "lunar",
      lunar_year: 2026, lunar_month: 8, lunar_day: 15, reminder_enabled: true, reminder_sent_for: null });
    expect(repaired.lunar_occurrence_dates).toContain("2027-09-15");
    expect(recoverLunarAnniversary(repaired)).toBeNull();
    expect(original.date).toBe("2026-10-27");
  });

  it("已迁移的错误农历节日和旧提醒缓存也重新校准", () => {
    expect(recoverLunarAnniversary({ kind: "holiday", title: "元宵节", date: "2026-03-04", calendar_type: "lunar",
      lunar_year: 2026, lunar_month: 1, lunar_day: 16, lunar_occurrence_dates: ["2026-03-04"] }))
      .toMatchObject({ date: "2026-03-03", lunar_month: 1, lunar_day: 15 });
  });

  it("已知农历生日只重算派生日期，并保留源年月日和提醒设置", () => {
    const repaired = recoverLunarAnniversary({ kind: "birthday", title: "家人生日", date: "1970-11-24", calendar_type: "lunar",
      lunar_year: 1970, lunar_month: 10, lunar_day: 27, lunar_is_leap_month: false,
      lunar_occurrence_dates: ["2026-11-24"], reminder_days_before: 5, reminder_time: "08:30" });
    expect(repaired).toMatchObject({ date: "1970-11-25", lunar_year: 1970, lunar_month: 10, lunar_day: 27,
      reminder_days_before: 5, reminder_time: "08:30" });
    expect(repaired?.lunar_occurrence_dates).toContain("2026-12-05");
  });

  it.each(["除夕", "大年三十", "2026年除夕"])("%s按实际年末恢复，不固定每年腊月三十", (title) => {
    const repaired = recoverLunarAnniversary({ kind: "holiday", title, date: "2026-02-16", calendar_type: "solar", note: "农历年末" });
    expect(repaired).toMatchObject({ date: "2026-02-16", lunar_year: 2025, lunar_month: 12, lunar_day: 29 });
    expect(repaired?.lunar_occurrence_dates).toContain("2027-02-05");
  });

  it("修复清明的固定公历日期及误标农历，并保留原来的提醒配置", () => {
    const record = { kind: "holiday", title: "清明节", date: "2028-04-05", calendar_type: "lunar",
      lunar_year: 2028, lunar_month: 2, lunar_day: 18, lunar_is_leap_month: false,
      lunar_occurrence_dates: ["2028-04-05"], reminder_enabled: true, reminder_days_before: 3, note: "原有备注" };
    const repaired = recoverLunarAnniversary(record)!;
    expect(repaired).toMatchObject({ calendar_type: "solar", date: "2028-04-04", lunar_year: null, lunar_month: null,
      lunar_day: null, lunar_occurrence_dates: [], reminder_enabled: true, reminder_days_before: 3, note: "原有备注" });
    expect(recoverLunarAnniversary(repaired)).toBeNull();
    expect(recoverLunarAnniversary({ ...record, calendar_type: "solar", lunar_year: null, lunar_month: null, lunar_day: null }))
      .toMatchObject({ calendar_type: "solar", date: "2028-04-04" });
  });

  it.each([
    { kind: "birthday", title: "家人生日", date: "2005-10-05", calendar_type: "solar", note: "" },
    { kind: "holiday", title: "中秋节", date: "2026-10-27", calendar_type: "solar", note: "" },
    { kind: "holiday", title: "劳动节", date: "2026-05-01", calendar_type: "solar", note: "用户曾说农历" },
    { kind: "anniversary", title: "中秋节出游纪念", date: "2026-10-27", calendar_type: "solar", note: "农历" },
    { kind: "birthday", title: "缺少日期", date: "2026-01-01", calendar_type: "lunar", lunar_year: 2026 },
    { kind: "holiday", title: "中秋节", date: "2026-10-27", calendar_type: "solar", note: "农历八月十五", deleted_at: "2026-11-01" }
  ])("不猜测生日、不转换公历节日、不恢复已删除记录：$title", (record) => {
    expect(recoverLunarAnniversary(record)).toBeNull();
  });
});
