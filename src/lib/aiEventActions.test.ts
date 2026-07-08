import { describe, expect, it } from "vitest";
import { eventItemFromAiAction } from "./aiEventActions";

describe("AI 助手创建事项动作", () => {
  it("把 AI 返回的定时事项转换为本地事项", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "交作业",
      startDate: "2026-07-09",
      startTime: "09:00",
      endTime: "09:00",
      allDay: false,
      note: "数学作业",
      reminderEnabled: true,
      reminderMinutesBefore: 30
    }, "明天 9:00 添加交作业", "user-1");

    expect(event).toMatchObject({
      user_id: "user-1",
      event_type: "event",
      title: "交作业",
      start_date: "2026-07-09",
      end_date: "2026-07-09",
      start_time: "09:00",
      end_time: "09:00",
      all_day: false,
      reminder_enabled: true,
      reminder_minutes_before: 30
    });
    expect(event?.note).toContain("数学作业");
    expect(event?.note).toContain("由 AI 助手创建");
  });

  it("缺少时间时创建全天事项", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "整理材料",
      startDate: "2026-07-10"
    }, "周五添加整理材料", "user-1");

    expect(event).toMatchObject({
      title: "整理材料",
      start_time: null,
      end_time: null,
      all_day: true
    });
  });

  it("拒绝无效日期", () => {
    const event = eventItemFromAiAction({
      type: "create_event",
      title: "错误事项",
      startDate: "tomorrow"
    }, "明天添加错误事项", "user-1");

    expect(event).toBeNull();
  });
});
