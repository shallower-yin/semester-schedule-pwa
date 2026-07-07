import { FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import {
  colorForImportedCourse,
  parseSchoolTimetableFiles,
  TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR,
  type ImportedClassPeriod,
  type ImportedCourseSchedule,
  type ImportedTimetable
} from "../lib/schoolTimetableImport";
import { syncFields } from "../lib/identity";
import type { ClassPeriod, Course, CourseSchedule, Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface SchoolTimetableImportDialogProps {
  semester: Semester;
  onClose: () => void;
}

interface ImportResult {
  courseCount: number;
  scheduleCount: number;
  periodCount: number;
  updatedSemester: boolean;
  replacedCourses: boolean;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as Weekday[];

export function SchoolTimetableImportDialog({ semester, onClose }: SchoolTimetableImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [timetable, setTimetable] = useState<ImportedTimetable | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [replaceCourses, setReplaceCourses] = useState(true);
  const [updatePeriods, setUpdatePeriods] = useState(true);
  const [syncSemesterInfo, setSyncSemesterInfo] = useState(true);
  const [firstWeekStartDate, setFirstWeekStartDate] = useState(semester.start_date);
  const [importing, setImporting] = useState(false);

  const uniqueCourseCount = useMemo(() => {
    if (!timetable) return 0;
    return new Set(timetable.schedules.map((schedule) => courseKey(schedule))).size;
  }, [timetable]);
  const maxWeek = useMemo(() => Math.max(semester.total_weeks, ...(timetable?.schedules.flatMap((schedule) => schedule.weeks) ?? [])), [semester.total_weeks, timetable]);

  async function loadFiles(files?: FileList | null) {
    if (!files?.length) return;
    setMessage("");
    setError("");
    try {
      const parsed = await parseSchoolTimetableFiles(files);
      setTimetable(parsed);
      setMessage(`已提取 ${parsed.periods.length} 个节次、${new Set(parsed.schedules.map((schedule) => courseKey(schedule))).size} 门课程、${parsed.schedules.length} 条上课安排。`);
    } catch (loadError) {
      setTimetable(null);
      setError(loadError instanceof Error ? loadError.message : "课表解析失败。");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function importTimetable() {
    if (!timetable || importing) return;
    if (!firstWeekStartDate) {
      setError("请先指定第一周第一天的日期。");
      return;
    }
    if (replaceCourses && !window.confirm("将替换当前学期已有课程和课程安排，普通事项不会删除。继续导入？")) return;
    setImporting(true);
    setMessage("");
    setError("");
    try {
      const result = await applyTimetableImport(semester, timetable, {
        replaceCourses,
        updatePeriods,
        syncSemesterInfo,
        firstWeekStartDate
      });
      setMessage(
        `导入完成：${result.replacedCourses ? "已替换旧课程，" : ""}写入 ${result.courseCount} 门课程、${result.scheduleCount} 条安排、${result.periodCount} 个节次` +
          `${result.updatedSemester ? "，并更新了学期日期/名称/周数" : ""}。登录后会自动同步到其他设备。`
      );
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "导入失败。");
    } finally {
      setImporting(false);
    }
  }

  function exportExtractedJson() {
    if (!timetable) return;
    const blob = new Blob([JSON.stringify(timetable, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal title={TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR} onClose={onClose} wide>
      <div className="backup-options">
        <section>
          <h3>选择天津大学导出的课表文件</h3>
          <p>
            支持天津大学教务系统导出的 Excel HTML 课表。若导出结果包含“课表.xls”和“课表.files”文件夹，请选择
            <strong> 课表.files/sheet001.htm </strong>
            ；外层 xls 通常只是跳转框架。
          </p>
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            multiple
            accept=".xls,.htm,.html,text/html,application/vnd.ms-excel"
            onChange={(event) => void loadFiles(event.target.files)}
          />
        </section>

        {timetable && (
          <section>
            <div className="import-summary">
              <FileSpreadsheet size={24} />
              <div>
                <h3>{timetable.termName ?? "未识别学期名称"}</h3>
                <p>
                  来源：{timetable.sourceName ?? "本地文件"}；解析：{timetable.parseMode === "task-activity" ? "TaskActivity 结构数据" : "HTML 表格"}；将导入 {uniqueCourseCount} 门课程、{timetable.schedules.length} 条安排、{timetable.periods.length} 个节次。
                </p>
              </div>
            </div>
            <div className="import-options">
              <label>
                第一周第一天日期
                <input type="date" value={firstWeekStartDate} onChange={(event) => setFirstWeekStartDate(event.target.value)} />
                <small>通常填本学期第 1 周星期一。课程周数会按这个日期换算成日历日期。</small>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={replaceCourses} onChange={(event) => setReplaceCourses(event.target.checked)} />
                替换当前学期已有课程和课程安排
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={updatePeriods} onChange={(event) => setUpdatePeriods(event.target.checked)} />
                用课表文件里的节次时间更新每日时间块
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={syncSemesterInfo} onChange={(event) => setSyncSemesterInfo(event.target.checked)} />
                同步学期名称，并把总周数扩展到 {maxWeek} 周；第一周日期总会按上方设置更新
              </label>
            </div>
            <div className="import-preview-list">
              {timetable.schedules.slice(0, 6).map((schedule, index) => (
                <div key={`${schedule.name}-${schedule.teacher}-${schedule.weekday}-${schedule.startPeriod}-${index}`}>
                  <strong>{schedule.name}</strong>
                  <span>
                    {schedule.teacher || "未识别教师"} · 周{schedule.weekday} · 第{schedule.startPeriod}-{schedule.endPeriod}节 · {formatWeeks(schedule.weeks)} · {schedule.classroom || "未识别教室"}
                  </span>
                </div>
              ))}
              {timetable.schedules.length > 6 && <p>还有 {timetable.schedules.length - 6} 条安排，导入后可在课程管理里查看。</p>}
            </div>
            <button type="button" className="button secondary compact" onClick={exportExtractedJson}>下载提取 JSON</button>
            {timetable.warnings.map((warning) => <p className="auth-message error" key={warning}>{warning}</p>)}
          </section>
        )}

        {message && <p className="status-message">{message}</p>}
        {error && <p className="auth-message error">{error}</p>}

        <div className="form-actions">
          <button className="button secondary" onClick={onClose}>关闭</button>
          <button className="button primary" disabled={!timetable || importing} onClick={() => void importTimetable()}>
            <Upload size={17} />{importing ? "导入中…" : "导入到当前学期"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

async function applyTimetableImport(
  semester: Semester,
  timetable: ImportedTimetable,
  options: { replaceCourses: boolean; updatePeriods: boolean; syncSemesterInfo: boolean; firstWeekStartDate: string }
): Promise<ImportResult> {
  if (!timetable.schedules.length) throw new Error("没有可导入的课程安排。");

  const courseGroups = groupCourses(timetable.schedules, semester.id, timetable.termName);
  const maxWeek = Math.max(semester.total_weeks, ...timetable.schedules.flatMap((schedule) => schedule.weeks));
  const periodBlocks = options.updatePeriods ? buildClassPeriodBlocks(semester.id, timetable.periods) : [];
  const deletedAt = new Date().toISOString();
  let replacedCourses = false;
  let updatedSemester = false;

  await db.transaction("rw", [db.semesters, db.classPeriods, db.courses, db.courseSchedules, db.courseCancellations, db.syncQueue], async () => {
    const shouldUpdateSemester =
      semester.start_date !== options.firstWeekStartDate ||
      (options.syncSemesterInfo && ((timetable.termName && timetable.termName !== semester.name) || maxWeek !== semester.total_weeks));
    if (shouldUpdateSemester) {
      const updatedSemesterRecord: Semester = {
        ...semester,
        ...syncFields(semester),
        start_date: options.firstWeekStartDate,
        name: options.syncSemesterInfo ? timetable.termName ?? semester.name : semester.name,
        total_weeks: options.syncSemesterInfo ? maxWeek : semester.total_weeks
      };
      await db.semesters.put(updatedSemesterRecord);
      await queueChange("semesters", updatedSemesterRecord.id);
      updatedSemester = true;
    }

    if (options.replaceCourses) {
      const existingCourses = await db.courses.where("semester_id").equals(semester.id).toArray();
      const activeCourses = existingCourses.filter((course) => !course.deleted_at);
      const activeCourseIds = new Set(activeCourses.map((course) => course.id));
      const existingSchedules = await db.courseSchedules.filter((schedule) => activeCourseIds.has(schedule.course_id) && !schedule.deleted_at).toArray();
      const existingScheduleIds = new Set(existingSchedules.map((schedule) => schedule.id));
      const existingCancellations = await db.courseCancellations.filter((item) => existingScheduleIds.has(item.course_schedule_id) && !item.deleted_at).toArray();

      for (const cancellation of existingCancellations) {
        await db.courseCancellations.put({ ...cancellation, ...syncFields(cancellation), deleted_at: deletedAt });
        await queueChange("courseCancellations", cancellation.id, "delete");
      }
      for (const schedule of existingSchedules) {
        await db.courseSchedules.put({ ...schedule, ...syncFields(schedule), deleted_at: deletedAt });
        await queueChange("courseSchedules", schedule.id, "delete");
      }
      for (const course of activeCourses) {
        await db.courses.put({ ...course, ...syncFields(course), deleted_at: deletedAt });
        await queueChange("courses", course.id, "delete");
      }
      replacedCourses = activeCourses.length > 0;
    }

    if (options.updatePeriods) {
      const existingPeriods = await db.classPeriods.where("semester_id").equals(semester.id).toArray();
      for (const period of existingPeriods.filter((item) => !item.deleted_at)) {
        await db.classPeriods.put({ ...period, ...syncFields(period), deleted_at: deletedAt });
        await queueChange("classPeriods", period.id, "delete");
      }
      for (const block of periodBlocks) {
        await db.classPeriods.put(block);
        await queueChange("classPeriods", block.id);
      }
    }

    for (const group of courseGroups) {
      await db.courses.put(group.course);
      await queueChange("courses", group.course.id);
      for (const schedule of group.schedules) {
        await db.courseSchedules.put(schedule);
        await queueChange("courseSchedules", schedule.id);
      }
    }
  });

  return {
    courseCount: courseGroups.length,
    scheduleCount: courseGroups.reduce((sum, group) => sum + group.schedules.length, 0),
    periodCount: options.updatePeriods ? timetable.periods.length : 0,
    updatedSemester,
    replacedCourses
  };
}

function groupCourses(schedules: ImportedCourseSchedule[], semesterId: string, termName: string | null) {
  const groups = new Map<string, { course: Course; schedules: CourseSchedule[] }>();
  for (const item of schedules) {
    const key = courseKey(item);
    let group = groups.get(key);
    if (!group) {
      const course: Course = {
        ...syncFields(),
        semester_id: semesterId,
        name: item.name,
        teacher: item.teacher,
        classroom: item.classroom,
        color: colorForImportedCourse(item.name),
        note: `由${TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR}导入${termName ? `：${termName}` : ""}`
      };
      group = { course, schedules: [] };
      groups.set(key, group);
    }
    group.schedules.push({
      ...syncFields(),
      course_id: group.course.id,
      weekday: item.weekday,
      start_period: item.startPeriod,
      end_period: item.endPeriod,
      weeks: item.weeks
    });
  }
  return Array.from(groups.values());
}

function buildClassPeriodBlocks(semesterId: string, periods: ImportedClassPeriod[]): ClassPeriod[] {
  const sorted = [...periods].sort((left, right) => left.periodNumber - right.periodNumber);
  return WEEKDAYS.flatMap((weekday) =>
    sorted.map((period, index) => ({
        ...syncFields(),
        semester_id: semesterId,
        weekday,
        period_number: period.periodNumber,
        kind: "period",
        sort_order: index + 1,
        name: period.name,
        start_time: period.startTime,
        end_time: period.endTime
      }))
  );
}

function courseKey(schedule: Pick<ImportedCourseSchedule, "name" | "teacher" | "classroom">): string {
  return `${schedule.name}\u0001${schedule.teacher}\u0001${schedule.classroom}`;
}

function formatWeeks(weeks: number[]): string {
  if (!weeks.length) return "未识别周数";
  if (weeks.length === 1) return `第${weeks[0]}周`;
  const ranges: string[] = [];
  let start = weeks[0];
  let previous = weeks[0];
  for (const week of weeks.slice(1)) {
    if (week === previous + 1) {
      previous = week;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = week;
    previous = week;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return `第${ranges.join("、")}周`;
}
