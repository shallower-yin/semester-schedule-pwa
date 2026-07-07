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
    ).toBe("结束时间不能早于开始时间。如果只需要一个提醒，可以把开始时间和结束时间设为相同。");
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
