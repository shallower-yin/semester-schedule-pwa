import { describe, expect, it } from "vitest";
import { buildDeepSeekScheduleContext } from "./deepSeekAssistant";
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
    expect(context.appGuide.join(" ")).toContain("不能直接修改、删除或完成已有记录");
  });
});
