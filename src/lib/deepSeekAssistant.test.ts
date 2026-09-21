import { describe, expect, it } from "vitest";
import { buildDeepSeekScheduleContext, resolveAiRequestedTimeScope } from "./deepSeekAssistant";
import type { ScheduleAssistantInput } from "./scheduleAssistant";

const emptyInput: ScheduleAssistantInput = {
  semester: null,
  courses: [],
  schedules: [],
  cancellations: [],
  events: [],
  categories: [],
  occurrenceStates: [],
  anniversaries: [],
  memos: [],
  periods: [],
  focusSessions: []
};

describe("AI 助手上下文", () => {
  it("按北京时间生成今天和使用说明", () => {
    const now = new Date("2026-07-09T16:30:00.000Z");
    const context = buildDeepSeekScheduleContext({ ...emptyInput, now });

    expect(context.generatedAt).toBe("2026-07-09T16:30:00.000Z");
    expect(context.today).toBe("2026-07-10");
    expect(context.timezone).toBe("Asia/Shanghai");
    expect(context.appGuide.join(" ")).toContain("回答本工具怎么使用");
    expect(context.appGuide.join(" ")).toContain("常见节日");
    expect(context.appGuide.join(" ")).toContain("普通用户和会员");
    expect(context.appGuide.join(" ")).toContain("重新发送会计入一次额度");
    expect(context.appGuide.join(" ")).toContain("可以新增、修改和删除普通事项");
  });

  it("本周请求只提供本周实际发生的课程，不暴露全量课程模板", () => {
    const now = new Date("2026-07-17T02:00:00.000Z");
    const sync = {
      user_id: "user-1",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      deleted_at: null,
      version: 1,
      device_id: "device-1"
    };
    const context = buildDeepSeekScheduleContext({
      ...emptyInput,
      now,
      semester: { ...sync, id: "semester-1", name: "测试学期", start_date: "2026-07-13", total_weeks: 4, is_current: true },
      courses: [
        { ...sync, id: "course-this-week", semester_id: "semester-1", name: "本周课程", teacher: "", classroom: "", color: "#000", note: "" },
        { ...sync, id: "course-next-week", semester_id: "semester-1", name: "下周课程", teacher: "", classroom: "", color: "#000", note: "" }
      ],
      schedules: [
        { ...sync, id: "schedule-this-week", course_id: "course-this-week", weekday: 1, start_period: 1, end_period: 2, weeks: [1] },
        { ...sync, id: "schedule-next-week", course_id: "course-next-week", weekday: 1, start_period: 3, end_period: 4, weeks: [2] }
      ]
    }, "梳理本周学习计划");

    expect(context.requestedTimeScope).toEqual({ label: "本周", startDate: "2026-07-13", endDate: "2026-07-19" });
    expect(context.calendarDays).toHaveLength(7);
    expect(context.calendarDays.flatMap((day) => day.courses).map((course) => course.title)).toEqual(["本周课程"]);
    expect(context.courseTemplates).toEqual([]);
  });

  it("解析相对时间时给出明确北京时间日期范围", () => {
    const today = new Date(2026, 6, 17);
    expect(resolveAiRequestedTimeScope("下周安排", today)).toEqual({
      label: "下周",
      startDate: "2026-07-20",
      endDate: "2026-07-26"
    });
  });

  it("修改请求能看到几周之后的事项，便于按标题匹配", () => {
    const now = new Date(2026, 6, 17);
    const sync = {
      user_id: "user-1",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      deleted_at: null,
      version: 1,
      device_id: "device-1"
    };
    const farAway = {
      ...sync,
      id: "event-far",
      event_type: "event" as const,
      title: "设计与制造基础3课程设计",
      start_date: "2026-09-21",
      end_date: "2026-09-21",
      start_time: "08:00",
      end_time: "10:00",
      all_day: false,
      category_id: null,
      color: "#e36b32",
      location: "",
      note: "",
      recurrence_type: "none" as const,
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: true,
      reminder_minutes_before: 15,
      timezone: "Asia/Shanghai",
      completed_at: null
    };
    const context = buildDeepSeekScheduleContext({
      ...emptyInput,
      now,
      events: [farAway]
    }, "把设计与制造基础3课程设计的上课时间改成上午十点");

    expect(context.requestedTimeScope).toBeNull();
    expect(context.recentEvents.map((item) => item.title)).toContain("设计与制造基础3课程设计");
  });

  it("识别具体星期和明确日期", () => {
    const today = new Date(2026, 6, 17);
    expect(resolveAiRequestedTimeScope("下周一有什么课", today)).toEqual({
      label: "下周一",
      startDate: "2026-07-20",
      endDate: "2026-07-20"
    });
    expect(resolveAiRequestedTimeScope("整理 7月18日 的任务", today)).toEqual({
      label: "2026-07-18",
      startDate: "2026-07-18",
      endDate: "2026-07-18"
    });
  });
});
