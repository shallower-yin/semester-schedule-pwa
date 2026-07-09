import { db, queueChange } from "../db";

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
    const periods = await db.classPeriods.where("semester_id").equals(semesterId).toArray();
    const courses = await db.courses.where("semester_id").equals(semesterId).toArray();
    const courseIds = new Set(courses.map((course) => course.id));
    const schedules = courseIds.size
      ? await db.courseSchedules.filter((item) => courseIds.has(item.course_id)).toArray()
      : [];
    const scheduleIds = new Set(schedules.map((schedule) => schedule.id));
    const cancellations = scheduleIds.size
      ? await db.courseCancellations.filter((item) => scheduleIds.has(item.course_schedule_id)).toArray()
      : [];

    for (const cancellation of cancellations) {
      await queueChange("courseCancellations", cancellation.id, "delete");
    }
    if (cancellations.length) await db.courseCancellations.bulkDelete(cancellations.map((item) => item.id));
    result.courseCancellations = cancellations.length;

    for (const schedule of schedules) await queueChange("courseSchedules", schedule.id, "delete");
    if (schedules.length) await db.courseSchedules.bulkDelete(schedules.map((item) => item.id));
    result.courseSchedules = schedules.length;

    for (const period of periods) await queueChange("classPeriods", period.id, "delete");
    if (periods.length) await db.classPeriods.bulkDelete(periods.map((item) => item.id));
    result.classPeriods = periods.length;

    for (const course of courses) await queueChange("courses", course.id, "delete");
    if (courses.length) await db.courses.bulkDelete(courses.map((item) => item.id));
    result.courses = courses.length;

    if (semester) {
      await queueChange("semesters", semester.id, "delete");
      await db.semesters.delete(semester.id);
      result.semesters = 1;
    }
  });

  return result;
}
