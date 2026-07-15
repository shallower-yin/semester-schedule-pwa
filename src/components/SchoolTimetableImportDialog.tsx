import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, FileSpreadsheet, GraduationCap, School, Upload } from "lucide-react";
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
import { hardDeleteLocalRecords } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { startOfWeek, toISODate } from "../lib/date";
import { deleteSemesterCascade, saveSemesterRecord } from "../lib/semesters";
import { showToast } from "../lib/toast";
import type { ClassPeriod, Course, CourseSchedule, Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface SchoolTimetableImportDialogProps {
  semester: Semester | null;
  onClose: () => void;
  onImported?: (semester: Semester) => void;
}

interface ImportResult {
  courseCount: number;
  scheduleCount: number;
  periodCount: number;
  updatedSemester: boolean;
  replacedCourses: boolean;
  createdCourses: number;
  updatedCourses: number;
  createdSchedules: number;
  updatedSchedules: number;
  skippedSchedules: number;
}

interface ImportPreviewConflict {
  importedName: string;
  existingName: string;
  weekday: Weekday;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
}

interface ImportPreview {
  newCourseCount: number;
  matchedCourseCount: number;
  nameConflictCourseCount: number;
  duplicateScheduleCount: number;
  expandingScheduleCount: number;
  timeConflictCount: number;
  conflicts: ImportPreviewConflict[];
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as Weekday[];
type ImportMode = "merge" | "replace" | "append";

export function SchoolTimetableImportDialog(props: SchoolTimetableImportDialogProps) {
  const [school, setSchool] = useState<"tianjin" | "tsinghua" | null>(null);
  if (!school) {
    return (
      <Modal title="课表提取器" onClose={props.onClose}>
        <div className="school-extractor-grid">
          <button onClick={() => setSchool("tianjin")}><School size={28} /><span><strong>天津大学</strong><small>支持教务系统导出的 HTML-XLS 课表</small></span></button>
          <button onClick={() => setSchool("tsinghua")}><GraduationCap size={28} /><span><strong>清华大学</strong><small>入口已保留，提取规则暂未支持</small></span></button>
        </div>
      </Modal>
    );
  }
  if (school === "tsinghua") {
    return (
      <Modal title="清华大学课表提取器" onClose={props.onClose}>
        <div className="unsupported-extractor"><GraduationCap size={38} /><h3>暂未支持</h3><p>入口已保留，后续补充清华大学课表文件解析规则后即可接入。</p><button className="button secondary" onClick={() => setSchool(null)}><ArrowLeft size={16} />返回学校选择</button></div>
      </Modal>
    );
  }
  return <TianjinTimetableImportDialog {...props} onBack={() => setSchool(null)} />;
}

function TianjinTimetableImportDialog({ semester, onClose, onImported, onBack }: SchoolTimetableImportDialogProps & { onBack: () => void }) {
  const workingSemester = useMemo<Semester>(() => semester ?? ({
    ...syncFields(),
    name: "新学期",
    start_date: toISODate(startOfWeek(new Date())),
    total_weeks: 20,
    is_current: true
  }), [semester?.id]);
  const existingCourses = useLiveQuery(
    () => semester ? db.courses.where("semester_id").equals(semester.id).filter((course) => !course.deleted_at).toArray() : [],
    [semester?.id]
  ) ?? [];
  const existingSchedules = useLiveQuery(
    async () => {
      if (!existingCourses.length) return [];
      const courseIds = new Set(existingCourses.map((course) => course.id));
      return db.courseSchedules.filter((schedule) => courseIds.has(schedule.course_id) && !schedule.deleted_at).toArray();
    },
    [existingCourses.map((course) => course.id).join(",")]
  ) ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [timetable, setTimetable] = useState<ImportedTimetable | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [updatePeriods, setUpdatePeriods] = useState(true);
  const [syncSemesterInfo, setSyncSemesterInfo] = useState(true);
  const [targetMode, setTargetMode] = useState<"current" | "new">(semester ? "current" : "new");
  const [newSemesterName, setNewSemesterName] = useState("");
  const [newSemesterWeeks, setNewSemesterWeeks] = useState(20);
  const [firstWeekStartDate, setFirstWeekStartDate] = useState(workingSemester.start_date);
  const [importing, setImporting] = useState(false);

  const uniqueCourseCount = useMemo(() => {
    if (!timetable) return 0;
    return new Set(timetable.schedules.map((schedule) => courseKey(schedule))).size;
  }, [timetable]);
  const maxWeek = useMemo(() => Math.max(targetMode === "current" ? workingSemester.total_weeks : newSemesterWeeks, ...(timetable?.schedules.flatMap((schedule) => schedule.weeks) ?? [])), [newSemesterWeeks, targetMode, timetable, workingSemester.total_weeks]);
  const importPreview = useMemo(
    () => timetable ? buildTimetableImportPreview(timetable, targetMode === "current" ? existingCourses : [], targetMode === "current" ? existingSchedules : []) : null,
    [existingCourses, existingSchedules, targetMode, timetable]
  );

  async function loadFiles(files?: FileList | null) {
    if (!files?.length) return;
    setMessage("");
    setError("");
    try {
      const parsed = await parseSchoolTimetableFiles(files);
      setTimetable(parsed);
      setNewSemesterName(parsed.termName ?? "");
      setNewSemesterWeeks(Math.max(1, ...parsed.schedules.flatMap((schedule) => schedule.weeks)));
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
    if (importMode === "replace" && !window.confirm("将彻底删除当前学期已有课程、课程安排和停课标记，再导入新课表；普通事项不会删除。继续导入？")) return;
    setImporting(true);
    setMessage("");
    setError("");
    let createdSemesterId: string | null = null;
    try {
      let targetSemester = workingSemester;
      if (targetMode === "new") {
        targetSemester = await saveSemesterRecord({
          name: newSemesterName || timetable.termName || "导入课表学期",
          startDate: firstWeekStartDate,
          totalWeeks: maxWeek,
          createDefaultPeriods: false
        });
        createdSemesterId = targetSemester.id;
      } else if (!semester) {
        throw new Error("当前没有可导入的学期，请选择新建学期并导入。");
      }
      const result = await applyTimetableImport(targetSemester, timetable, {
        importMode,
        updatePeriods,
        syncSemesterInfo: targetMode === "new" ? true : syncSemesterInfo,
        firstWeekStartDate
      });
      onImported?.(targetSemester);
      setMessage(
        `导入完成：${result.replacedCourses ? "已替换旧课程，" : ""}` +
          `新增 ${result.createdCourses} 门课程、更新 ${result.updatedCourses} 门课程；新增 ${result.createdSchedules} 条安排、更新 ${result.updatedSchedules} 条安排、跳过 ${result.skippedSchedules} 条重复安排；写入 ${result.periodCount} 个节次` +
          `${result.updatedSemester ? "，并更新了学期日期/名称/周数" : ""}。登录后会自动同步到其他设备。`
      );
      showToast(`课表导入完成：新增 ${result.createdCourses} 门课程、${result.createdSchedules} 条安排。`, "success");
    } catch (applyError) {
      if (createdSemesterId) {
        try {
          await deleteSemesterCascade(createdSemesterId);
          if (semester) {
            await saveSemesterRecord({
              semester,
              name: semester.name,
              startDate: semester.start_date,
              totalWeeks: semester.total_weeks,
              createDefaultPeriods: false
            });
          }
        } catch {
          // Keep the original import error visible; local data health tools can repair an interrupted rollback.
        }
      }
      const message = applyError instanceof Error ? applyError.message : "导入失败。";
      setError(message);
      showToast(message, "error");
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
    <Modal title="课表提取器 · 天津大学" onClose={onClose} wide>
      <div className="backup-options">
        <button className="button secondary compact extractor-back" onClick={onBack}><ArrowLeft size={16} />返回学校选择</button>
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
                导入到
                <select value={targetMode} onChange={(event) => setTargetMode(event.target.value === "new" ? "new" : "current")}>
                  <option value="current" disabled={!semester}>导入当前学期{semester ? `：${semester.name}` : "（暂无）"}</option>
                  <option value="new">新建学期并导入</option>
                </select>
              </label>
              {targetMode === "new" && <>
                <label>
                  学期名称
                  <input value={newSemesterName} onChange={(event) => setNewSemesterName(event.target.value)} placeholder="例如：2026 秋季学期" />
                </label>
                <label>
                  总周数
                  <input type="number" min={1} max={60} value={newSemesterWeeks} onChange={(event) => setNewSemesterWeeks(Number(event.target.value))} />
                </label>
              </>}
              <label>
                第一周第一天日期
                <input type="date" value={firstWeekStartDate} onChange={(event) => setFirstWeekStartDate(event.target.value)} />
                <small>通常填本学期第 1 周星期一。课程周数会按这个日期换算成日历日期。</small>
              </label>
              <label>
                导入模式
                <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
                  <option value="merge">合并防重复：更新已有课程并补充新安排</option>
                  <option value="replace">替换当前学期课表：彻底删除旧课程再导入</option>
                  <option value="append">仅追加：不检查重复，全部作为新课程导入</option>
                </select>
                <small>默认建议使用“合并防重复”。如果学校课表整体变动很大，再使用“替换”。</small>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={updatePeriods} onChange={(event) => setUpdatePeriods(event.target.checked)} />
                用课表文件里的节次时间更新每日时间块
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={syncSemesterInfo} disabled={targetMode === "new"} onChange={(event) => setSyncSemesterInfo(event.target.checked)} />
                同步学期名称，并把总周数扩展到 {maxWeek} 周；第一周日期总会按上方设置更新
              </label>
            </div>
            {importPreview && (
              <div className="import-preview-summary">
                <article>
                  <strong>{importPreview.newCourseCount}</strong>
                  <span>新增课程</span>
                </article>
                <article>
                  <strong>{importPreview.matchedCourseCount}</strong>
                  <span>匹配已有</span>
                </article>
                <article>
                  <strong>{importPreview.expandingScheduleCount}</strong>
                  <span>扩展周数</span>
                </article>
                <article>
                  <strong>{importPreview.duplicateScheduleCount}</strong>
                  <span>重复跳过</span>
                </article>
                <article className={importPreview.timeConflictCount ? "warning" : ""}>
                  <strong>{importPreview.timeConflictCount}</strong>
                  <span>时间冲突</span>
                </article>
              </div>
            )}
            {importPreview && (importPreview.nameConflictCourseCount > 0 || importPreview.timeConflictCount > 0 || (importMode === "append" && importPreview.duplicateScheduleCount > 0)) && (
              <div className="import-conflict-panel">
                {importPreview.nameConflictCourseCount > 0 && <p>有 {importPreview.nameConflictCourseCount} 门导入课程与现有课程同名但教室不同，导入前建议核对。</p>}
                {importMode === "append" && importPreview.duplicateScheduleCount > 0 && <p>当前为追加模式，检测到的重复安排也会作为新课程/新安排写入。</p>}
                {importPreview.conflicts.length > 0 && (
                  <>
                    <strong>可能冲突的已有课程</strong>
                    {importPreview.conflicts.slice(0, 5).map((conflict) => (
                      <span key={`${conflict.importedName}-${conflict.existingName}-${conflict.weekday}-${conflict.startPeriod}`}>
                        {conflict.importedName} 与 {conflict.existingName}：周{conflict.weekday} 第{conflict.startPeriod}-{conflict.endPeriod}节，{formatWeeks(conflict.weeks)}
                      </span>
                    ))}
                    {importPreview.conflicts.length > 5 && <span>还有 {importPreview.conflicts.length - 5} 条冲突未显示。</span>}
                  </>
                )}
              </div>
            )}
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
            <Upload size={17} />{importing ? "导入中…" : targetMode === "new" ? "新建学期并导入" : "导入到当前学期"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function buildTimetableImportPreview(
  timetable: ImportedTimetable,
  existingCourses: Course[],
  existingSchedules: CourseSchedule[]
): ImportPreview {
  const activeCourses = existingCourses.filter((course) => !course.deleted_at);
  const activeSchedules = existingSchedules.filter((schedule) => !schedule.deleted_at);
  const courseById = new Map(activeCourses.map((course) => [course.id, course]));
  const courseByKey = new Map(activeCourses.map((course) => [courseKey(course), course]));
  const coursesByName = new Map<string, Course[]>();
  for (const course of activeCourses) {
    coursesByName.set(course.name, [...(coursesByName.get(course.name) ?? []), course]);
  }
  const schedulesByCourseId = new Map<string, CourseSchedule[]>();
  for (const schedule of activeSchedules) {
    schedulesByCourseId.set(schedule.course_id, [...(schedulesByCourseId.get(schedule.course_id) ?? []), schedule]);
  }

  const importedGroups = new Map<string, { name: string; classroom: string; schedules: ImportedCourseSchedule[]; scheduleKeys: Set<string> }>();
  for (const schedule of timetable.schedules) {
    const key = courseKey(schedule);
    const group = importedGroups.get(key) ?? { name: schedule.name, classroom: schedule.classroom, schedules: [], scheduleKeys: new Set<string>() };
    const keyForSchedule = `${schedule.weekday}\u0001${schedule.startPeriod}\u0001${schedule.endPeriod}`;
    const existingIndex = group.schedules.findIndex((item) => `${item.weekday}\u0001${item.startPeriod}\u0001${item.endPeriod}` === keyForSchedule);
    if (existingIndex >= 0) {
      group.schedules[existingIndex] = {
        ...group.schedules[existingIndex],
        weeks: mergeWeeks(group.schedules[existingIndex].weeks, schedule.weeks)
      };
    } else {
      group.schedules.push({ ...schedule, weeks: [...schedule.weeks] });
    }
    group.scheduleKeys.add(keyForSchedule);
    importedGroups.set(key, group);
  }

  let newCourseCount = 0;
  let matchedCourseCount = 0;
  let nameConflictCourseCount = 0;
  let duplicateScheduleCount = 0;
  let expandingScheduleCount = 0;
  const conflicts = new Map<string, ImportPreviewConflict>();

  for (const [groupKey, group] of importedGroups) {
    const matchedCourse = courseByKey.get(groupKey);
    if (matchedCourse) matchedCourseCount += 1;
    else {
      newCourseCount += 1;
      if ((coursesByName.get(group.name) ?? []).some((course) => course.classroom !== group.classroom)) {
        nameConflictCourseCount += 1;
      }
    }

    if (matchedCourse) {
      const matchedSchedules = schedulesByCourseId.get(matchedCourse.id) ?? [];
      for (const schedule of group.schedules) {
        const existingSchedule = matchedSchedules.find(
          (item) => item.weekday === schedule.weekday && item.start_period === schedule.startPeriod && item.end_period === schedule.endPeriod
        );
        if (!existingSchedule) continue;
        const mergedWeeks = mergeWeeks(existingSchedule.weeks, schedule.weeks);
        if (sameWeeks(existingSchedule.weeks, mergedWeeks)) duplicateScheduleCount += 1;
        else expandingScheduleCount += 1;
      }
    }

    for (const schedule of group.schedules) {
      for (const existingSchedule of activeSchedules) {
        const existingCourse = courseById.get(existingSchedule.course_id);
        if (!existingCourse || courseKey(existingCourse) === groupKey) continue;
        if (existingSchedule.weekday !== schedule.weekday) continue;
        if (!periodsOverlap(existingSchedule.start_period, existingSchedule.end_period, schedule.startPeriod, schedule.endPeriod)) continue;
        const overlappingWeeks = schedule.weeks.filter((week) => existingSchedule.weeks.includes(week));
        if (!overlappingWeeks.length) continue;
        const conflictKey = `${group.name}\u0001${existingCourse.name}\u0001${schedule.weekday}\u0001${schedule.startPeriod}\u0001${existingSchedule.id}`;
        conflicts.set(conflictKey, {
          importedName: group.name,
          existingName: existingCourse.name,
          weekday: schedule.weekday,
          startPeriod: Math.max(existingSchedule.start_period, schedule.startPeriod),
          endPeriod: Math.min(existingSchedule.end_period, schedule.endPeriod),
          weeks: overlappingWeeks
        });
      }
    }
  }

  return {
    newCourseCount,
    matchedCourseCount,
    nameConflictCourseCount,
    duplicateScheduleCount,
    expandingScheduleCount,
    timeConflictCount: conflicts.size,
    conflicts: Array.from(conflicts.values())
  };
}

export async function applyTimetableImport(
  semester: Semester,
  timetable: ImportedTimetable,
  options: { importMode: ImportMode; updatePeriods: boolean; syncSemesterInfo: boolean; firstWeekStartDate: string }
): Promise<ImportResult> {
  if (!timetable.schedules.length) throw new Error("没有可导入的课程安排。");

  const courseGroups = groupCourses(timetable.schedules, semester.id, timetable.termName);
  const maxWeek = Math.max(semester.total_weeks, ...timetable.schedules.flatMap((schedule) => schedule.weeks));
  const periodBlocks = options.updatePeriods ? buildClassPeriodBlocks(semester.id, timetable.periods) : [];
  let replacedCourses = false;
  let updatedSemester = false;
  let createdCourses = 0;
  let updatedCourses = 0;
  let createdSchedules = 0;
  let updatedSchedules = 0;
  let skippedSchedules = 0;

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

    if (options.importMode === "replace") {
      const existingCourses = await db.courses.where("semester_id").equals(semester.id).toArray();
      const activeCourses = existingCourses.filter((course) => !course.deleted_at);
      const activeCourseIds = new Set(activeCourses.map((course) => course.id));
      const existingSchedules = await db.courseSchedules.filter((schedule) => activeCourseIds.has(schedule.course_id) && !schedule.deleted_at).toArray();
      const existingScheduleIds = new Set(existingSchedules.map((schedule) => schedule.id));
      const existingCancellations = await db.courseCancellations.filter((item) => existingScheduleIds.has(item.course_schedule_id) && !item.deleted_at).toArray();

      await hardDeleteLocalRecords("courseCancellations", existingCancellations.map((item) => item.id));
      await hardDeleteLocalRecords("courseSchedules", existingSchedules.map((item) => item.id));
      await hardDeleteLocalRecords("courses", activeCourses.map((item) => item.id));
      replacedCourses = activeCourses.length > 0;
    }

    if (options.updatePeriods) {
      const existingPeriods = await db.classPeriods.where("semester_id").equals(semester.id).toArray();
      await hardDeleteLocalRecords("classPeriods", existingPeriods.filter((item) => !item.deleted_at).map((item) => item.id));
      for (const block of periodBlocks) {
        await db.classPeriods.put(block);
        await queueChange("classPeriods", block.id);
      }
    }

    const existingActiveCourses =
      options.importMode === "merge"
        ? await db.courses.where("semester_id").equals(semester.id).filter((course) => !course.deleted_at).toArray()
        : [];
    const existingCourseMap = new Map(existingActiveCourses.map((course) => [courseKey(course), course]));

    for (const group of courseGroups) {
      const existingCourse = options.importMode === "merge" ? existingCourseMap.get(courseKey(group.course)) : undefined;
      if (!existingCourse) {
        await db.courses.put(group.course);
        await queueChange("courses", group.course.id);
        createdCourses += 1;
        for (const schedule of group.schedules) {
          await db.courseSchedules.put(schedule);
          await queueChange("courseSchedules", schedule.id);
          createdSchedules += 1;
        }
        continue;
      }

      const updatedCourse: Course = {
        ...existingCourse,
        ...syncFields(existingCourse),
        teacher: mergeTeacherText(existingCourse.teacher, group.course.teacher),
        classroom: group.course.classroom || existingCourse.classroom,
        color: existingCourse.color || group.course.color,
        note: existingCourse.note || group.course.note,
        deleted_at: null
      };
      await db.courses.put(updatedCourse);
      await queueChange("courses", updatedCourse.id);
      updatedCourses += 1;

      const activeSchedules = await db.courseSchedules.where("course_id").equals(existingCourse.id).filter((schedule) => !schedule.deleted_at).toArray();
      const scheduleMap = new Map(activeSchedules.map((schedule) => [scheduleKey(schedule), schedule]));
      for (const schedule of group.schedules) {
        const existingSchedule = scheduleMap.get(scheduleKey(schedule));
        if (!existingSchedule) {
          const createdSchedule: CourseSchedule = {
            ...schedule,
            course_id: existingCourse.id
          };
          await db.courseSchedules.put(createdSchedule);
          await queueChange("courseSchedules", createdSchedule.id);
          createdSchedules += 1;
          continue;
        }
        const weeks = mergeWeeks(existingSchedule.weeks, schedule.weeks);
        if (sameWeeks(existingSchedule.weeks, weeks)) {
          skippedSchedules += 1;
          continue;
        }
        const updatedSchedule: CourseSchedule = {
          ...existingSchedule,
          ...syncFields(existingSchedule),
          weeks
        };
        await db.courseSchedules.put(updatedSchedule);
        await queueChange("courseSchedules", updatedSchedule.id);
        updatedSchedules += 1;
      }
    }
  });

  return {
    courseCount: courseGroups.length,
    scheduleCount: createdSchedules + updatedSchedules + skippedSchedules,
    periodCount: options.updatePeriods ? timetable.periods.length : 0,
    updatedSemester,
    replacedCourses,
    createdCourses,
    updatedCourses,
    createdSchedules,
    updatedSchedules,
    skippedSchedules
  };
}

export function groupCourses(schedules: ImportedCourseSchedule[], semesterId: string, termName: string | null) {
  const groups = new Map<
    string,
    {
      course: Course;
      schedules: CourseSchedule[];
      scheduleMap: Map<string, CourseSchedule>;
      teacherNames: Set<string>;
    }
  >();
  for (const item of schedules) {
    const key = courseKey(item);
    let group = groups.get(key);
    if (!group) {
      const course: Course = {
        ...syncFields(),
        semester_id: semesterId,
        name: item.name,
        teacher: "",
        classroom: item.classroom,
        color: colorForImportedCourse(item.name),
        note: `由${TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR}导入${termName ? `：${termName}` : ""}`
      };
      group = { course, schedules: [], scheduleMap: new Map(), teacherNames: new Set() };
      groups.set(key, group);
    }
    addTeacherNames(group.teacherNames, item.teacher);
    group.course.teacher = Array.from(group.teacherNames).join(",");

    const scheduleKey = `${item.weekday}\u0001${item.startPeriod}\u0001${item.endPeriod}`;
    const existingSchedule = group.scheduleMap.get(scheduleKey);
    if (existingSchedule) {
      existingSchedule.weeks = mergeWeeks(existingSchedule.weeks, item.weeks);
      continue;
    }
    const schedule: CourseSchedule = {
      ...syncFields(),
      course_id: group.course.id,
      weekday: item.weekday,
      start_period: item.startPeriod,
      end_period: item.endPeriod,
      weeks: [...item.weeks]
    };
    group.scheduleMap.set(scheduleKey, schedule);
    group.schedules.push(schedule);
  }
  return Array.from(groups.values()).map(({ course, schedules }) => ({ course, schedules }));
}

export function buildClassPeriodBlocks(semesterId: string, periods: ImportedClassPeriod[]): ClassPeriod[] {
  const sorted = [...periods].sort((left, right) => left.periodNumber - right.periodNumber);
  const fourthPeriod = sorted.find((period) => period.periodNumber === 4);
  const fifthPeriod = sorted.find((period) => period.periodNumber === 5);
  const lunch =
    fourthPeriod && fifthPeriod && timeToMinutes(fifthPeriod.startTime) > timeToMinutes(fourthPeriod.endTime)
      ? { startTime: fourthPeriod.endTime, endTime: fifthPeriod.startTime }
      : null;

  return WEEKDAYS.flatMap((weekday) => {
    const blocks: ClassPeriod[] = [];
    let sortOrder = 1;
    for (const period of sorted) {
      blocks.push({
        ...syncFields(),
        semester_id: semesterId,
        weekday,
        period_number: period.periodNumber,
        kind: "period",
        sort_order: sortOrder++,
        name: period.name,
        start_time: period.startTime,
        end_time: period.endTime
      });
      if (period.periodNumber === 4 && lunch) {
        blocks.push({
          ...syncFields(),
          semester_id: semesterId,
          weekday,
          period_number: 0,
          kind: "break",
          sort_order: sortOrder++,
          name: "午休",
          start_time: lunch.startTime,
          end_time: lunch.endTime
        });
      }
    }
    return blocks;
  });
}

function addTeacherNames(target: Set<string>, teacher: string) {
  for (const name of teacher.split(/[，,、]/).map((item) => item.trim()).filter(Boolean)) {
    target.add(name);
  }
}

function mergeWeeks(left: number[], right: number[]): number[] {
  return Array.from(new Set([...left, ...right])).sort((a, b) => a - b);
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function courseKey(schedule: Pick<ImportedCourseSchedule | Course, "name" | "classroom">): string {
  return `${schedule.name}\u0001${schedule.classroom}`;
}

function scheduleKey(schedule: Pick<CourseSchedule, "weekday" | "start_period" | "end_period">): string {
  return `${schedule.weekday}\u0001${schedule.start_period}\u0001${schedule.end_period}`;
}

function mergeTeacherText(left: string, right: string): string {
  const names = new Set<string>();
  addTeacherNames(names, left);
  addTeacherNames(names, right);
  return Array.from(names).join(",");
}

function sameWeeks(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((week, index) => week === right[index]);
}

function periodsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
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
