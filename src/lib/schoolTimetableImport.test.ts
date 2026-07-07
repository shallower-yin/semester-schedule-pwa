import { describe, expect, it } from "vitest";
import { parseSchoolTimetableHtml, parseWeeks } from "./schoolTimetableImport";

const fixture = `
<html>
  <body>
    <table>
      <tr><td colspan="8">2025-2026学年第二学期</td></tr>
      <tr>
        <td>节次/周次</td>
        <td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td>
      </tr>
      <tr>
        <td>第一节 08:30-09:15</td>
        <td rowspan="2" title="测试与控制技术基础3 (肖聚亮);(1-6 周,37楼515);测试与控制技术基础3 (张宏伟);(7-11 周,37楼515)">测试与控制技术基础3</td>
        <td rowspan="2" title="设计与制造基础3B (陈光);;;(1-14 周,32楼B区126)">设计与制造基础3B</td>
        <td></td><td></td><td></td><td></td><td></td>
      </tr>
      <tr>
        <td>第二节 09:20-10:05</td>
        <td></td><td></td><td></td><td></td><td></td>
      </tr>
      <tr>
        <td>第三节 10:25-11:10</td>
        <td></td><td></td><td></td>
        <td rowspan="2" title="创业认知基础 (张琳);(单1-7 9-11 15 周,45楼B110)">创业认知基础</td>
        <td></td><td></td><td></td>
      </tr>
      <tr>
        <td>第四节 11:15-12:00</td>
        <td></td><td></td><td></td><td></td><td></td><td></td>
      </tr>
    </table>
  </body>
</html>`;

const taskActivityFixture = `
<html>
  <body>
    <table>
      <tr><td colspan="8">个人课程表</td></tr>
      <tr><td colspan="8">2025-2026学年第二学期</td></tr>
      <tr><td colspan="8">学号:3023001217 学生姓名:尹广洋 所属班级: 2023机械设计制造及其自动化1班 总学分:21.5</td></tr>
      <tr>
        <td>节次/周次</td>
        <td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td>
      </tr>
      <tr><td>第七节 15:25-16:10</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>第八节 16:15-17:00</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr>
        <td>
          <script>
            var unitCount = 12;
            var teachers = [{id:10743,name:"赵相松",lab:false}];
            var actTeachers = [{id:10743,name:"赵相松",lab:false},{id:99999,name:"实验助教",lab:true}];
            var assistant = [];
            var actTeacherId = [];
            var actTeacherName = [];
            activity = new TaskActivity(actTeacherId.join(','),actTeacherName.join(','),"18013(01876)","测试与控制技术基础2","4007","33楼140","01111111111110000000000000000000000000000000000000000",null,"",assistantName,"","","");
            index = 0*unitCount+6;
            table0.activities[index][table0.activities[index].length]=activity;
            index = 0*unitCount+7;
            table0.activities[index][table0.activities[index].length]=activity;
          </script>
        </td>
      </tr>
    </table>
  </body>
</html>`;

describe("school timetable import", () => {
  it("prefers Tianjin University TaskActivity data when available", () => {
    const result = parseSchoolTimetableHtml(taskActivityFixture, "sheet001.htm");

    expect(result.parseMode).toBe("task-activity");
    expect(result.studentId).toBe("3023001217");
    expect(result.studentName).toBe("尹广洋");
    expect(result.className).toBe("2023机械设计制造及其自动化1班");
    expect(result.periods).toEqual([
      { periodNumber: 7, name: "第七节", startTime: "15:25", endTime: "16:10" },
      { periodNumber: 8, name: "第八节", startTime: "16:15", endTime: "17:00" }
    ]);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toMatchObject({
      name: "测试与控制技术基础2",
      teacher: "赵相松",
      classroom: "33楼140",
      weekday: 1,
      startPeriod: 7,
      endPeriod: 8,
      weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      sourceTaskId: "18013(01876)",
      sourceRoomId: "4007"
    });
  });

  it("parses Excel HTML timetable cells into structured schedules", () => {
    const result = parseSchoolTimetableHtml(fixture, "sheet001.htm");

    expect(result.termName).toBe("2025-2026学年第二学期");
    expect(result.periods).toEqual([
      { periodNumber: 1, name: "第一节", startTime: "08:30", endTime: "09:15" },
      { periodNumber: 2, name: "第二节", startTime: "09:20", endTime: "10:05" },
      { periodNumber: 3, name: "第三节", startTime: "10:25", endTime: "11:10" },
      { periodNumber: 4, name: "第四节", startTime: "11:15", endTime: "12:00" }
    ]);
    expect(result.schedules).toHaveLength(4);
    expect(result.schedules[0]).toMatchObject({
      name: "测试与控制技术基础3",
      teacher: "肖聚亮",
      classroom: "37楼515",
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      weeks: [1, 2, 3, 4, 5, 6]
    });
    expect(result.schedules[1]).toMatchObject({
      name: "测试与控制技术基础3",
      teacher: "张宏伟",
      classroom: "37楼515",
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      weeks: [7, 8, 9, 10, 11]
    });
    expect(result.schedules[2]).toMatchObject({
      name: "设计与制造基础3B",
      teacher: "陈光",
      classroom: "32楼B区126",
      weekday: 2,
      startPeriod: 1,
      endPeriod: 2
    });
    expect(result.schedules[3]).toMatchObject({
      name: "创业认知基础",
      teacher: "张琳",
      classroom: "45楼B110",
      weekday: 4,
      startPeriod: 3,
      endPeriod: 4,
      weeks: [1, 3, 5, 7, 9, 11, 15]
    });
  });

  it("detects Excel frame files without timetable rows", () => {
    const result = parseSchoolTimetableHtml('<html><head><meta name="Excel Workbook Frameset"></head><frameset><frame src="课表.files/sheet001.htm"></frameset></html>');

    expect(result.isFrameFile).toBe(true);
    expect(result.schedules).toHaveLength(0);
    expect(result.warnings[0]).toContain("外层");
  });

  it("parses week ranges and odd or even week notation", () => {
    expect(parseWeeks("1-4 8 10 周")).toEqual([1, 2, 3, 4, 8, 10]);
    expect(parseWeeks("单1-7 9-11 15 周")).toEqual([1, 3, 5, 7, 9, 11, 15]);
    expect(parseWeeks("双2-8 11 周")).toEqual([2, 4, 6, 8]);
  });
});
