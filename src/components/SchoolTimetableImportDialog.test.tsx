import { describe, expect, it } from "vitest";
import { buildClassPeriodBlocks, groupCourses } from "./SchoolTimetableImportDialog";
import type { ImportedCourseSchedule } from "../lib/schoolTimetableImport";

describe("教务课表导入写入规则", () => {
  it("合并同课程同教室的分段教师和周数", () => {
    const schedules: ImportedCourseSchedule[] = [
      {
        name: "能源管理与规范",
        teacher: "雷海燕",
        classroom: "55楼B区316",
        weekday: 3,
        startPeriod: 5,
        endPeriod: 6,
        weeks: [1, 2, 3, 4, 5, 6],
        rawText: ""
      },
      {
        name: "能源管理与规范",
        teacher: "吕心力",
        classroom: "55楼B区316",
        weekday: 3,
        startPeriod: 5,
        endPeriod: 6,
        weeks: [7, 8, 9, 10, 11, 12],
        rawText: ""
      }
    ];

    const groups = groupCourses(schedules, "semester-1", "2025-2026学年第二学期");

    expect(groups).toHaveLength(1);
    expect(groups[0].course.name).toBe("能源管理与规范");
    expect(groups[0].course.teacher).toBe("雷海燕,吕心力");
    expect(groups[0].course.classroom).toBe("55楼B区316");
    expect(groups[0].schedules).toHaveLength(1);
    expect(groups[0].schedules[0]).toMatchObject({
      weekday: 3,
      start_period: 5,
      end_period: 6,
      weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    });
  });

  it("只在第四节和第五节之间生成午休，不生成每节之间的短休息", () => {
    const blocks = buildClassPeriodBlocks("semester-1", [
      { periodNumber: 1, name: "第一节", startTime: "08:30", endTime: "09:15" },
      { periodNumber: 2, name: "第二节", startTime: "09:20", endTime: "10:05" },
      { periodNumber: 3, name: "第三节", startTime: "10:25", endTime: "11:10" },
      { periodNumber: 4, name: "第四节", startTime: "11:15", endTime: "12:00" },
      { periodNumber: 5, name: "第五节", startTime: "13:30", endTime: "14:15" }
    ]);

    const mondayBlocks = blocks.filter((block) => block.weekday === 1);

    expect(mondayBlocks.map((block) => block.name)).toEqual(["第一节", "第二节", "第三节", "第四节", "午休", "第五节"]);
    expect(mondayBlocks.filter((block) => block.kind === "break")).toEqual([
      expect.objectContaining({
        name: "午休",
        start_time: "12:00",
        end_time: "13:30",
        period_number: 0
      })
    ]);
  });
});
