import { db, putRecordAndQueue, queueChange } from "../db";
import type { SyncTableName } from "../types";
import { syncFields } from "./identity";

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

async function resolveDeletionOwner(tableName: SyncTableName, recordId: string, record?: { user_id?: string }): Promise<string> {
  if (record?.user_id) return record.user_id;
  const queued = await db.syncQueue
    .filter((item) => item.table_name === tableName && item.record_id === recordId)
    .toArray();
  const owners = new Set(queued.map((item) => item.owner_id).filter(Boolean));
  if (owners.size === 1) return [...owners][0];
  throw new Error(`无法确定待删除记录的归属：${tableName}/${recordId}`);
}

export async function hardDeleteLocalRecord(tableName: SyncTableName, recordId: string): Promise<void> {
  const record = await db.table(tableName).get(recordId) as { user_id?: string } | undefined;
  const ownerId = await resolveDeletionOwner(tableName, recordId, record);
  await queueChange(tableName, recordId, "delete", ownerId);
  await db.table(tableName).delete(recordId);
}

export async function hardDeleteLocalRecords(tableName: SyncTableName, recordIds: string[]): Promise<void> {
  const ids = uniqueIds(recordIds);
  if (!ids.length) return;
  const records = await db.table(tableName).bulkGet(ids) as Array<{ user_id?: string } | undefined>;
  for (const [index, id] of ids.entries()) {
    const ownerId = await resolveDeletionOwner(tableName, id, records[index]);
    await queueChange(tableName, id, "delete", ownerId);
  }
  await db.table(tableName).bulkDelete(ids);
}

export async function hardDeleteEventsCascade(eventIds: string[]): Promise<void> {
  const ids = uniqueIds(eventIds);
  if (!ids.length) return;
  await db.transaction("rw", db.events, db.eventOccurrenceStates, db.focusSessions, db.syncQueue, async () => {
    const stateIds: string[] = [];
    for (const eventId of ids) {
      const states = await db.eventOccurrenceStates.where("event_id").equals(eventId).toArray();
      stateIds.push(...states.map((state) => state.id));
    }
    const linkedSessions = await db.focusSessions
      .filter((session) => Boolean(session.linked_event_id) && ids.includes(String(session.linked_event_id)))
      .toArray();
    for (const session of linkedSessions) {
      const updated = { ...session, ...syncFields(session), linked_event_id: null };
      await putRecordAndQueue("focusSessions", updated);
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
