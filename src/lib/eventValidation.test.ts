import { describe, expect, it } from "vitest";
import { validateEventDraft } from "./eventValidation";

describe("事项时间校验", () => {
  it("允许结束时间等于开始时间，适合只需要提醒的事项", () => {
    expect(
      validateEventDraft({
        title: "提醒",
        allDay: false,
        startTime: "09:15",
        endTime: "09:15"
      })
    ).toBeNull();
  });

  it("结束时间早于开始时间时返回明确提示", () => {
    expect(
      validateEventDraft({
        title: "提醒",
        allDay: false,
        startTime: "10:00",
        endTime: "09:59"
      })
    ).toBe("跨夜事项请把结束日期设为第二天；同一天的结束时间不能早于开始时间。");
  });

  it("允许结束日期在第二天的跨夜事项", () => {
    expect(
      validateEventDraft({
        title: "夜间值班",
        startDate: "2026-07-31",
        endDate: "2026-08-01",
        allDay: false,
        startTime: "22:30",
        endTime: "01:00"
      })
    ).toBeNull();
  });

  it("标题为空时返回明确提示", () => {
    expect(
      validateEventDraft({
        title: " ",
        allDay: false,
        startTime: "09:15",
        endTime: "09:15"
      })
    ).toBe("请填写事项标题。");
  });
});
