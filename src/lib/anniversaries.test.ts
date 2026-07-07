import { describe, expect, it } from "vitest";
import type { Anniversary } from "../types";
import {
  anniversaryDistanceLabel,
  anniversaryReminderTimeForOccurrence,
  dueAnniversaryOccurrence,
  formatAnniversaryReminderLead,
  nextAnniversaryOccurrence
} from "./anniversaries";
import { toISODate } from "./date";

describe("纪念日日期和提醒", () => {
  it("按提前天数和指定时间计算提醒触发点", () => {
    const reminderAt = anniversaryReminderTimeForOccurrence(
      { reminder_days_before: 2, reminder_time: "08:30" },
      new Date(2026, 6, 9)
    );

    expect(toISODate(reminderAt)).toBe("2026-07-07");
    expect(reminderAt.getHours()).toBe(8);
    expect(reminderAt.getMinutes()).toBe(30);
  });

  it("在提醒时间后的短窗口内判定为到期", () => {
    const anniversary = anniversaryRecord({
      date: "2020-07-09",
      reminder_days_before: 2,
      reminder_time: "08:30"
    });

    expect(toISODate(dueAnniversaryOccurrence(anniversary, new Date(2026, 6, 7, 8, 35))!)).toBe("2026-07-09");
    expect(dueAnniversaryOccurrence(anniversary, new Date(2026, 6, 7, 8, 46))).toBeNull();
  });

  it("支持当天提醒", () => {
    const anniversary = anniversaryRecord({
      date: "2020-07-07",
      reminder_days_before: 0,
      reminder_time: "09:00"
    });

    expect(toISODate(dueAnniversaryOccurrence(anniversary, new Date(2026, 6, 7, 9, 0))!)).toBe("2026-07-07");
    expect(formatAnniversaryReminderLead(0)).toBe("当天");
  });

  it("2 月 29 日在非闰年按 2 月 28 日处理", () => {
    expect(toISODate(nextAnniversaryOccurrence({ date: "2020-02-29" }, new Date(2027, 1, 27)))).toBe("2027-02-28");
    expect(toISODate(nextAnniversaryOccurrence({ date: "2020-02-29" }, new Date(2027, 2, 1)))).toBe("2028-02-29");
  });

  it("纪念日显示已过去天数，生日和节日显示下次还有几天", () => {
    const now = new Date(2026, 6, 8);

    expect(anniversaryDistanceLabel({ kind: "anniversary", date: "2026-03-27" }, now)).toBe("103 天前");
    expect(anniversaryDistanceLabel({ kind: "birthday", date: "2000-10-18" }, now)).toBe("102 天后");
    expect(anniversaryDistanceLabel({ kind: "holiday", date: "2026-01-01" }, now)).toBe("177 天后");
  });
});

function anniversaryRecord(overrides: Partial<Anniversary>): Anniversary {
  return {
    id: "anniversary-1",
    user_id: "local",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    device_id: "device-1",
    kind: "anniversary",
    title: "测试纪念日",
    date: "2020-07-07",
    color: "#d97706",
    note: "",
    reminder_enabled: true,
    reminder_days_before: 0,
    reminder_time: "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}
