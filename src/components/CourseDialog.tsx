import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { db, queueChange } from "../db";
import { WEEKDAY_NAMES } from "../data/defaults";
import { findCourseEventConflicts, findCourseScheduleConflicts } from "../lib/conflicts";
import { hardDeleteCoursesCascade, hardDeleteLocalRecords } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import type { Course, CourseSchedule, Semester, Weekday } from "../types";
import { Modal } from "./Modal";

interface ScheduleDraft {
  id?: string;
  weekday: Weekday;
  start_period: number;
  end_period: number;
  weeks: number[];
}

interface CourseDialogProps {
  semester: Semester;
  course?: Course;
  onClose: () => void;
}

export function CourseDialog({ semester, course, onClose }: CourseDialogProps) {
  const periods = useLiveQuery(
    () => db.classPeriods.where("semester_id").equals(semester.id).filter((item) => !item.deleted_at && item.kind !== "break").toArray(),
    [semester.id]
  ) ?? [];
  const [name, setName] = useState(course?.name ?? "");
  const [teacher, setTeacher] = useState(course?.teacher ?? "");
  const [classroom, setClassroom] = useState(course?.classroom ?? "");
  const [color, setColor] = useState(course?.color ?? "#5b78df");
  const [note, setNote] = useState(course?.note ?? "");
  const [schedules, setSchedules] = useState<ScheduleDraft[]>([
    { weekday: 1, start_period: 1, end_period: 2, weeks: Array.from({ length: semester.total_weeks }, (_, index) => index + 1) }
  ]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!course) return;
    db.courseSchedules
      .where("course_id")
      .equals(course.id)
      .filter((item) => !item.deleted_at)
      .toArray()
      .then((items) => {
        if (items.length) {
          setSchedules(
            items.map((item) => ({
              id: item.id,
              weekday: item.weekday,
              start_period: item.start_period,
              end_period: item.end_period,
              weeks: item.weeks
            }))
          );
        }
      });
  }, [course]);

  useEffect(() => {
    if (course || !periods.length) return;
    setSchedules((current) =>
      current.map((schedule) => {
        const available = periods
          .filter((period) => period.weekday === schedule.weekday && period.kind !== "break")
          .sort((left, right) => left.sort_order - right.sort_order);
        if (available.some((period) => period.period_number === schedule.start_period)) return schedule;
        return {
          ...schedule,
          start_period: available[0]?.period_number ?? schedule.start_period,
          end_period: available[1]?.period_number ?? available[0]?.period_number ?? schedule.end_period
        };
      })
    );
  }, [course, periods]);

  function updateSchedule(index: number, patch: Partial<ScheduleDraft>) {
    setSchedules((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function toggleWeek(index: number, week: number) {
    const current = schedules[index].weeks;
    updateSchedule(index, { weeks: current.includes(week) ? current.filter((value) => value !== week) : [...current, week].sort((a, b) => a - b) });
  }

  function periodsForWeekday(weekday: Weekday) {
    return periods
      .filter((period) => period.weekday === weekday && period.kind !== "break")
      .sort((left, right) => left.sort_order - right.sort_order);
  }

  function addSchedule() {
    const weekday: Weekday = 1;
    const dayPeriods = periodsForWeekday(weekday);
    setSchedules((current) => [
      ...current,
      {
        weekday,
        start_period: dayPeriods[0]?.period_number ?? 1,
        end_period: dayPeriods[1]?.period_number ?? dayPeriods[0]?.period_number ?? 1,
        weeks: []
      }
    ]);
  }

  function changeWeekday(index: number, weekday: Weekday) {
    const dayPeriods = periodsForWeekday(weekday);
    updateSchedule(index, {
      weekday,
      start_period: dayPeriods[0]?.period_number ?? 1,
      end_period: dayPeriods[1]?.period_number ?? dayPeriods[0]?.period_number ?? 1
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const invalidSchedule = schedules.some((item) => {
      const dayPeriods = periodsForWeekday(item.weekday);
      const startIndex = dayPeriods.findIndex((period) => period.period_number === item.start_period);
      const endIndex = dayPeriods.findIndex((period) => period.period_number === item.end_period);
      return item.weeks.length === 0 || startIndex < 0 || endIndex < startIndex;
    });
    if (!name.trim() || invalidSchedule) return;
    setSaving(true);
    const courseRecord: Course = {
      ...syncFields(course),
      semester_id: semester.id,
      name: name.trim(),
      teacher: teacher.trim(),
      classroom: classroom.trim(),
      color,
      note: note.trim()
    };
    const existingCourses = await db.courses.where("semester_id").equals(semester.id).filter((item) => !item.deleted_at).toArray();
    const existingCourseIds = new Set(existingCourses.map((item) => item.id));
    const existingSchedules = await db.courseSchedules.filter((item) => existingCourseIds.has(item.course_id) && !item.deleted_at).toArray();
    const existingEvents = await db.events.filter((item) => item.user_id === semester.user_id && !item.deleted_at).toArray();
    const conflicts = [
      ...findCourseScheduleConflicts(courseRecord.id, courseRecord.name, existingSchedules, existingCourses, schedules),
      ...findCourseEventConflicts(semester, schedules, periods, existingEvents)
    ].slice(0, 5);
    if (conflicts.length) {
      const conflictMessage = `可能与 ${conflicts.map((item) => `“${item.title}”(${item.detail})`).join("、")} 冲突。仍然保存？`;
      if (!window.confirm(conflictMessage)) {
        setMessage(conflictMessage);
        setSaving(false);
        return;
      }
    }
    await db.transaction("rw", db.courses, db.courseSchedules, db.courseCancellations, db.syncQueue, async () => {
      await db.courses.put(courseRecord);
      await queueChange("courses", courseRecord.id);
      const oldSchedules = course ? await db.courseSchedules.where("course_id").equals(course.id).toArray() : [];
      const retainedIds = new Set(schedules.flatMap((item) => (item.id ? [item.id] : [])));
      const removedScheduleIds = oldSchedules.filter((item) => !retainedIds.has(item.id)).map((item) => item.id);
      if (removedScheduleIds.length) {
        const removedScheduleIdSet = new Set(removedScheduleIds);
        const cancellations = await db.courseCancellations
          .filter((item) => removedScheduleIdSet.has(item.course_schedule_id))
          .toArray();
        await hardDeleteLocalRecords("courseCancellations", cancellations.map((item) => item.id));
        await hardDeleteLocalRecords("courseSchedules", removedScheduleIds);
      }
      for (const item of schedules) {
        const existing = oldSchedules.find((old) => old.id === item.id);
        const record: CourseSchedule = {
          ...syncFields(existing),
          course_id: courseRecord.id,
          weekday: item.weekday,
          start_period: item.start_period,
          end_period: item.end_period,
          weeks: item.weeks
        };
        await db.courseSchedules.put(record);
        await queueChange("courseSchedules", record.id);
      }
    });
    setSaving(false);
    onClose();
  }

  async function removeCourse() {
    if (!course || !window.confirm(`确定彻底删除课程“${course.name}”吗？该课程的上课安排和停课标记会一并删除，且无法恢复。`)) return;
    await hardDeleteCoursesCascade([course.id]);
    onClose();
  }

  return (
    <Modal title={course ? "编辑课程" : "新增课程"} onClose={onClose} wide>
      <form className="form-stack" onSubmit={save}>
        <div className="form-grid">
          <label className="span-2">课程名称<input required autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>教师<input value={teacher} onChange={(event) => setTeacher(event.target.value)} /></label>
          <label>教室<input value={classroom} onChange={(event) => setClassroom(event.target.value)} /></label>
          <label>颜色<input className="color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label className="span-2">备注<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>

        <div className="section-heading">
          <div><h3>上课安排</h3><p>每个安排可以选择不同的星期、节次和周数。</p></div>
          <button
            type="button"
            className="button secondary compact"
            onClick={addSchedule}
          >
            <Plus size={16} /> 添加
          </button>
        </div>

        {schedules.map((schedule, index) => (
          <div className="schedule-editor" key={schedule.id ?? index}>
            <div className="schedule-row">
              <label>星期
                <select value={schedule.weekday} onChange={(event) => changeWeekday(index, Number(event.target.value) as Weekday)}>
                  {WEEKDAY_NAMES.map((day, dayIndex) => <option key={day} value={dayIndex + 1}>{day}</option>)}
                </select>
              </label>
              <label>开始节次
                <select value={schedule.start_period} onChange={(event) => updateSchedule(index, { start_period: Number(event.target.value) })}>
                  {periodsForWeekday(schedule.weekday).map((period) => <option key={period.id} value={period.period_number}>{period.name}（{period.start_time}）</option>)}
                </select>
              </label>
              <label>结束节次
                <select value={schedule.end_period} onChange={(event) => updateSchedule(index, { end_period: Number(event.target.value) })}>
                  {periodsForWeekday(schedule.weekday).map((period) => <option key={period.id} value={period.period_number}>{period.name}（{period.end_time}）</option>)}
                </select>
              </label>
              {schedules.length > 1 && (
                <button type="button" className="icon-button danger" onClick={() => setSchedules((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="删除安排">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            <div className="week-picker-label">
              <span>上课周数（已选 {schedule.weeks.length} 周）</span>
              <div>
                <button type="button" className="text-button" onClick={() => updateSchedule(index, { weeks: Array.from({ length: semester.total_weeks }, (_, itemIndex) => itemIndex + 1) })}>全选</button>
                <button type="button" className="text-button" onClick={() => updateSchedule(index, { weeks: [] })}>清空</button>
              </div>
            </div>
            <div className="week-picker">
              {Array.from({ length: semester.total_weeks }, (_, weekIndex) => weekIndex + 1).map((week) => (
                <button
                  key={week}
                  type="button"
                  className={schedule.weeks.includes(week) ? "selected" : ""}
                  onClick={() => toggleWeek(index, week)}
                >
                  {week}
                </button>
              ))}
            </div>
          </div>
        ))}
        {message && <p className="auth-message">{message}</p>}

        <div className="form-actions split">
          <div>{course && <button type="button" className="button danger-button" onClick={removeCourse}>彻底删除课程</button>}</div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存课程"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
