import { db, queueChange } from "../db";
import type { SyncTableName } from "../types";

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export async function hardDeleteLocalRecord(tableName: SyncTableName, recordId: string): Promise<void> {
  await queueChange(tableName, recordId, "delete");
  await db.table(tableName).delete(recordId);
}

export async function hardDeleteLocalRecords(tableName: SyncTableName, recordIds: string[]): Promise<void> {
  const ids = uniqueIds(recordIds);
  if (!ids.length) return;
  for (const id of ids) await queueChange(tableName, id, "delete");
  await db.table(tableName).bulkDelete(ids);
}

export async function hardDeleteEventsCascade(eventIds: string[]): Promise<void> {
  const ids = uniqueIds(eventIds);
  if (!ids.length) return;
  await db.transaction("rw", db.events, db.eventOccurrenceStates, db.syncQueue, async () => {
    const stateIds: string[] = [];
    for (const eventId of ids) {
      const states = await db.eventOccurrenceStates.where("event_id").equals(eventId).toArray();
      stateIds.push(...states.map((state) => state.id));
    }
    await hardDeleteLocalRecords("eventOccurrenceStates", stateIds);
    await hardDeleteLocalRecords("events", ids);
  });
}

export async function hardDeleteCourseSchedulesCascade(scheduleIds: string[]): Promise<void> {
  const ids = uniqueIds(scheduleIds);
  if (!ids.length) return;
  await db.transaction("rw", db.courseSchedules, db.courseCancellations, db.syncQueue, async () => {
    const cancellations = await db.courseCancellations
      .filter((item) => ids.includes(item.course_schedule_id))
      .toArray();
    await hardDeleteLocalRecords("courseCancellations", cancellations.map((item) => item.id));
    await hardDeleteLocalRecords("courseSchedules", ids);
  });
}

export async function hardDeleteCoursesCascade(courseIds: string[]): Promise<void> {
  const ids = uniqueIds(courseIds);
  if (!ids.length) return;
  await db.transaction("rw", db.courses, db.courseSchedules, db.courseCancellations, db.syncQueue, async () => {
    const schedules = await db.courseSchedules
      .filter((schedule) => ids.includes(schedule.course_id))
      .toArray();
    const scheduleIds = schedules.map((schedule) => schedule.id);
    const cancellations = scheduleIds.length
      ? await db.courseCancellations.filter((item) => scheduleIds.includes(item.course_schedule_id)).toArray()
      : [];
    await hardDeleteLocalRecords("courseCancellations", cancellations.map((item) => item.id));
    await hardDeleteLocalRecords("courseSchedules", scheduleIds);
    await hardDeleteLocalRecords("courses", ids);
  });
}
