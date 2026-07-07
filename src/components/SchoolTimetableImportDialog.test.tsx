import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { ImportedCourseSchedule, ImportedTimetable } from "../lib/schoolTimetableImport";
import type { Course, CourseSchedule, Semester } from "../types";
import { applyTimetableImport, buildClassPeriodBlocks, groupCourses } from "./SchoolTimetableImportDialog";

describe("教务课表导入写入规则", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.semesters.clear();
    await db.courses.clear();
    await db.courseSchedules.clear();
    await db.courseCancellations.clear();
    await db.classPeriods.clear();
    await db.syncQueue.clear();
  });

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

  it("合并导入时复用已有课程并合并相同时间段周数", async () => {
    const semester: Semester = {
      ...syncFields(),
      id: "semester-1",
      name: "2026春",
      start_date: "2026-02-23",
      total_weeks: 16,
      is_current: true
    };
    const course: Course = {
      ...syncFields(),
      id: "course-1",
      semester_id: semester.id,
      name: "数学",
      teacher: "旧老师",
      classroom: "A101",
      color: "#4f6bdc",
      note: ""
    };
    const schedule: CourseSchedule = {
      ...syncFields(),
      id: "schedule-1",
      course_id: course.id,
      weekday: 1,
      start_period: 1,
      end_period: 2,
      weeks: [1]
    };
    await db.semesters.put(semester);
    await db.courses.put(course);
    await db.courseSchedules.put(schedule);

    const timetable: ImportedTimetable = {
      sourceName: "sheet001.htm",
      extractorName: "天津大学课表提取器",
      parseMode: "task-activity",
      isFrameFile: false,
      termName: "2026春",
      studentId: null,
      studentName: null,
      className: null,
      totalCredits: null,
      periods: [],
      warnings: [],
      schedules: [
        {
          name: "数学",
          teacher: "新老师",
          classroom: "A101",
          weekday: 1,
          startPeriod: 1,
          endPeriod: 2,
          weeks: [1, 2],
          rawText: ""
        },
        {
          name: "数学",
          teacher: "新老师",
          classroom: "A101",
          weekday: 1,
          startPeriod: 3,
          endPeriod: 4,
          weeks: [3],
          rawText: ""
        }
      ]
    };

    const result = await applyTimetableImport(semester, timetable, {
      importMode: "merge",
      updatePeriods: false,
      syncSemesterInfo: false,
      firstWeekStartDate: semester.start_date
    });

    const activeCourses = await db.courses.filter((item) => !item.deleted_at).toArray();
    const activeSchedules = await db.courseSchedules.filter((item) => !item.deleted_at).toArray();

    expect(result).toMatchObject({
      createdCourses: 0,
      updatedCourses: 1,
      createdSchedules: 1,
      updatedSchedules: 1,
      skippedSchedules: 0
    });
    expect(activeCourses).toHaveLength(1);
    expect(activeCourses[0].teacher).toBe("旧老师,新老师");
    expect(activeSchedules).toHaveLength(2);
    expect(activeSchedules.find((item) => item.id === "schedule-1")?.weeks).toEqual([1, 2]);
  });
});
