import { db, queueChange } from "../db";
import type { SyncFields } from "../types";
import { syncFields } from "./identity";

export interface DeleteSemesterResult {
  semesters: number;
  classPeriods: number;
  courses: number;
  courseSchedules: number;
  courseCancellations: number;
}

export async function deleteSemesterCascade(semesterId: string): Promise<DeleteSemesterResult> {
  const result: DeleteSemesterResult = {
    semesters: 0,
    classPeriods: 0,
    courses: 0,
    courseSchedules: 0,
    courseCancellations: 0
  };

  await db.transaction("rw", [db.semesters, db.classPeriods, db.courses, db.courseSchedules, db.courseCancellations, db.syncQueue], async () => {
    const semester = await db.semesters.get(semesterId);
    if (semester && !semester.deleted_at) {
      await db.semesters.put({ ...softDeleted(semester), is_current: false });
      await queueChange("semesters", semester.id);
      result.semesters += 1;
    }

    const periods = await db.classPeriods.where("semester_id").equals(semesterId).filter((item) => !item.deleted_at).toArray();
    for (const period of periods) {
      await db.classPeriods.put(softDeleted(period));
      await queueChange("classPeriods", period.id);
      result.classPeriods += 1;
    }

    const courses = await db.courses.where("semester_id").equals(semesterId).filter((item) => !item.deleted_at).toArray();
    const courseIds = new Set(courses.map((course) => course.id));
    for (const course of courses) {
      await db.courses.put(softDeleted(course));
      await queueChange("courses", course.id);
      result.courses += 1;
    }

    const schedules = courseIds.size
      ? await db.courseSchedules.filter((item) => courseIds.has(item.course_id) && !item.deleted_at).toArray()
      : [];
    const scheduleIds = new Set(schedules.map((schedule) => schedule.id));
    for (const schedule of schedules) {
      await db.courseSchedules.put(softDeleted(schedule));
      await queueChange("courseSchedules", schedule.id);
      result.courseSchedules += 1;
    }

    const cancellations = scheduleIds.size
      ? await db.courseCancellations.filter((item) => scheduleIds.has(item.course_schedule_id) && !item.deleted_at).toArray()
      : [];
    for (const cancellation of cancellations) {
      await db.courseCancellations.put(softDeleted(cancellation));
      await queueChange("courseCancellations", cancellation.id);
      result.courseCancellations += 1;
    }
  });

  return result;
}

function softDeleted<T extends SyncFields>(record: T): T {
  const fields = syncFields(record);
  return {
    ...record,
    ...fields,
    deleted_at: fields.updated_at
  };
}
