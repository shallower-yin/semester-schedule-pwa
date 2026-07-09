import { db } from "../db";
import type { EventOccurrenceState, SyncQueueItem, SyncTableName } from "../types";
import { deduplicateCategories } from "./categories";
import { syncFields } from "./identity";
import { deduplicateLocalOccurrenceStates } from "./occurrenceStates";
import { supabase } from "./supabase";

export const SYNC_TABLES: Array<{ local: SyncTableName; remote: string; label: string }> = [
  { local: "semesters", remote: "semesters", label: "学期" },
  { local: "categories", remote: "categories", label: "分类" },
  { local: "classPeriods", remote: "class_periods", label: "时间块" },
  { local: "courses", remote: "courses", label: "课程" },
  { local: "courseSchedules", remote: "course_schedules", label: "课程安排" },
  { local: "courseCancellations", remote: "course_cancellations", label: "停课标记" },
  { local: "events", remote: "events", label: "事项" },
  { local: "eventOccurrenceStates", remote: "event_occurrence_states", label: "事项状态" },
  { local: "anniversaries", remote: "anniversaries", label: "纪念日" },
  { local: "memoFolders", remote: "memo_folders", label: "备忘录文件夹" },
  { local: "memos", remote: "memos", label: "备忘录" },
  { local: "focusSettings", remote: "focus_settings", label: "专注设置" },
  { local: "focusSessions", remote: "focus_sessions", label: "专注记录" }
];

const TABLES = SYNC_TABLES;

const DELETE_TABLES = [
  "courseCancellations",
  "courseSchedules",
  "classPeriods",
  "courses",
  "semesters",
  "eventOccurrenceStates",
  "focusSessions",
  "events",
  "memos",
  "memoFolders",
  "anniversaries",
  "categories",
  "focusSettings"
].map((tableName) => TABLES.find((table) => table.local === tableName)).filter(Boolean) as typeof TABLES;

export const SYNC_TABLE_LABELS = Object.fromEntries(
  SYNC_TABLES.map((table) => [table.local, table.label])
) as Record<SyncTableName, string>;

export interface SyncQueueTableHealth {
  table_name: SyncTableName;
  label: string;
  pending: number;
  failed: number;
  attempts: number;
  oldest_queued_at: string | null;
  last_error: string | null;
}

export interface SyncHealth {
  pending: number;
  failed: number;
  oldest_queued_at: string | null;
  checked_at: string;
  online: boolean;
  cloud_configured: boolean;
  tables: SyncQueueTableHealth[];
}

export async function getSyncHealth(): Promise<SyncHealth> {
  const queued = await db.syncQueue.orderBy("queued_at").toArray();
  const byTable = new Map<SyncTableName, SyncQueueItem[]>();
  for (const item of queued) {
    const items = byTable.get(item.table_name) ?? [];
    items.push(item);
    byTable.set(item.table_name, items);
  }

  const tables = Array.from(byTable.entries())
    .map(([tableName, items]) => {
      const sorted = [...items].sort((left, right) => left.queued_at.localeCompare(right.queued_at));
      const failedItems = items.filter((item) => item.last_error || item.attempts > 0);
      const lastFailed = [...failedItems].sort((left, right) => right.queued_at.localeCompare(left.queued_at))[0];
      return {
        table_name: tableName,
        label: SYNC_TABLE_LABELS[tableName] ?? tableName,
        pending: items.length,
        failed: failedItems.length,
        attempts: items.reduce((sum, item) => sum + item.attempts, 0),
        oldest_queued_at: sorted[0]?.queued_at ?? null,
        last_error: lastFailed?.last_error ?? null
      };
    })
    .sort((left, right) => right.pending - left.pending || left.label.localeCompare(right.label, "zh-CN"));

  return {
    pending: queued.length,
    failed: queued.filter((item) => item.last_error || item.attempts > 0).length,
    oldest_queued_at: queued.sort((left, right) => left.queued_at.localeCompare(right.queued_at))[0]?.queued_at ?? null,
    checked_at: new Date().toISOString(),
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    cloud_configured: Boolean(supabase),
    tables
  };
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  completed_at: string;
}

let activeSync: Promise<SyncResult> | null = null;

function queueRecord(table_name: SyncTableName, record_id: string, operation: "upsert" | "delete" = "upsert"): SyncQueueItem {
  return {
    id: crypto.randomUUID(),
    table_name,
    record_id,
    operation,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  };
}

async function putQueueItem(table_name: SyncTableName, record_id: string, operation: "upsert" | "delete" = "upsert") {
  const existing = await db.syncQueue
    .where("table_name")
    .equals(table_name)
    .and((item) => item.record_id === record_id)
    .toArray();
  const retained = existing[0] ?? queueRecord(table_name, record_id, operation);
  if (existing.length > 1) {
    await db.syncQueue.bulkDelete(existing.slice(1).map((item) => item.id));
  }
  await db.syncQueue.put({
    ...retained,
    operation,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  });
}

export async function adoptAnonymousData(userId: string): Promise<number> {
  let adopted = 0;
  const transactionTables = [...TABLES.map(({ local }) => db.table(local)), db.syncQueue];
  await db.transaction("rw", transactionTables, async () => {
    for (const { local } of TABLES) {
      const records = await db.table(local).filter((record) => record.user_id === "local").toArray();
      for (const record of records) {
        const updated = {
          ...record,
          user_id: userId,
          updated_at: new Date().toISOString(),
          version: Number(record.version ?? 0) + 1
        };
        await db.table(local).put(updated);
        const existingQueue = await db.syncQueue
          .where("table_name")
          .equals(local)
          .and((item) => item.record_id === record.id)
          .first();
        await db.syncQueue.put(existingQueue ? { ...existingQueue, queued_at: new Date().toISOString() } : queueRecord(local, record.id));
        adopted += 1;
      }
    }
  });
  return adopted;
}

function normalizeRemoteRecord(table: SyncTableName, record: Record<string, unknown>) {
  if (table === "classPeriods") {
    return {
      ...record,
      kind: record.kind ?? "period",
      sort_order: Number(record.sort_order ?? record.period_number ?? 0),
      start_time: String(record.start_time).slice(0, 5),
      end_time: String(record.end_time).slice(0, 5)
    };
  }
  if (table === "events") {
    return {
      ...record,
      event_type: record.event_type ?? "event",
      start_time: record.start_time ? String(record.start_time).slice(0, 5) : null,
      end_time: record.end_time ? String(record.end_time).slice(0, 5) : null,
      location: String(record.location ?? ""),
      reminder_enabled: Boolean(record.reminder_enabled),
      reminder_minutes_before: Number(record.reminder_minutes_before ?? 10),
      recurrence_interval: Number(record.recurrence_interval ?? 1),
      timezone: String(record.timezone ?? "Asia/Shanghai")
    };
  }
  if (table === "eventOccurrenceStates") {
    return { ...record, reminder_sent_at: record.reminder_sent_at ?? null };
  }
  if (table === "anniversaries") {
    return {
      ...record,
      kind: record.kind ?? "anniversary",
      color: String(record.color ?? "#d97706"),
      note: String(record.note ?? ""),
      reminder_enabled: Boolean(record.reminder_enabled),
      reminder_days_before: Number(record.reminder_days_before ?? 0),
      reminder_time: String(record.reminder_time ?? "09:00").slice(0, 5),
      reminder_sent_for: record.reminder_sent_for ?? null,
      timezone: String(record.timezone ?? "Asia/Shanghai")
    };
  }
  if (table === "memos") {
    return {
      ...record,
      folder_id: record.folder_id ?? null,
      is_pinned: Boolean(record.is_pinned)
    };
  }
  if (table === "focusSettings") {
    return {
      ...record,
      pomodoro_minutes: Number(record.pomodoro_minutes ?? 25),
      short_break_minutes: Number(record.short_break_minutes ?? 5),
      countdown_minutes: Number(record.countdown_minutes ?? 30),
      daily_goal_minutes: Number(record.daily_goal_minutes ?? 120),
      sound_enabled: Boolean(record.sound_enabled)
    };
  }
  if (table === "focusSessions") {
    return {
      ...record,
      linked_event_id: record.linked_event_id ?? null,
      planned_seconds: record.planned_seconds == null ? null : Number(record.planned_seconds),
      duration_seconds: Number(record.duration_seconds ?? 0),
      completed: Boolean(record.completed),
      interrupted: Boolean(record.interrupted)
    };
  }
  return record;
}

function emptyDeleteMap(): Map<SyncTableName, Set<string>> {
  return new Map(SYNC_TABLES.map((table) => [table.local, new Set<string>()]));
}

function addDeleteId(idsByTable: Map<SyncTableName, Set<string>>, tableName: SyncTableName, id: unknown) {
  if (!id) return;
  idsByTable.get(tableName)?.add(String(id));
}

function idsFor(idsByTable: Map<SyncTableName, Set<string>>, tableName: SyncTableName): Set<string> {
  return idsByTable.get(tableName) ?? new Set<string>();
}

function recordsFor(recordsByTable: Map<SyncTableName, Record<string, unknown>[]>, tableName: SyncTableName): Record<string, unknown>[] {
  return recordsByTable.get(tableName) ?? [];
}

function collectHardDeleteIds(recordsByTable: Map<SyncTableName, Record<string, unknown>[]>): Map<SyncTableName, Set<string>> {
  const idsByTable = emptyDeleteMap();

  for (const table of SYNC_TABLES) {
    for (const record of recordsFor(recordsByTable, table.local)) {
      if (record.deleted_at) addDeleteId(idsByTable, table.local, record.id);
    }
  }

  const semesterIds = idsFor(idsByTable, "semesters");
  for (const period of recordsFor(recordsByTable, "classPeriods")) {
    if (semesterIds.has(String(period.semester_id))) addDeleteId(idsByTable, "classPeriods", period.id);
  }
  for (const course of recordsFor(recordsByTable, "courses")) {
    if (semesterIds.has(String(course.semester_id))) addDeleteId(idsByTable, "courses", course.id);
  }

  const courseIds = idsFor(idsByTable, "courses");
  for (const schedule of recordsFor(recordsByTable, "courseSchedules")) {
    if (courseIds.has(String(schedule.course_id))) addDeleteId(idsByTable, "courseSchedules", schedule.id);
  }

  const scheduleIds = idsFor(idsByTable, "courseSchedules");
  for (const cancellation of recordsFor(recordsByTable, "courseCancellations")) {
    if (scheduleIds.has(String(cancellation.course_schedule_id))) addDeleteId(idsByTable, "courseCancellations", cancellation.id);
  }

  const eventIds = idsFor(idsByTable, "events");
  for (const state of recordsFor(recordsByTable, "eventOccurrenceStates")) {
    if (eventIds.has(String(state.event_id))) addDeleteId(idsByTable, "eventOccurrenceStates", state.id);
  }

  return idsByTable;
}

async function releaseLocalReferencesForHardDeletes(userId: string, idsByTable: Map<SyncTableName, Set<string>>) {
  const eventIds = idsFor(idsByTable, "events");
  const deletedFocusSessionIds = idsFor(idsByTable, "focusSessions");
  if (eventIds.size) {
    const sessions = await db.focusSessions
      .filter((session) =>
        session.user_id === userId
        && Boolean(session.linked_event_id)
        && eventIds.has(String(session.linked_event_id))
        && !deletedFocusSessionIds.has(session.id)
      )
      .toArray();
    for (const session of sessions) {
      const updated = { ...session, ...syncFields(session), linked_event_id: null };
      await db.focusSessions.put(updated);
      await putQueueItem("focusSessions", updated.id);
    }
  }

  const folderIds = idsFor(idsByTable, "memoFolders");
  const deletedMemoIds = idsFor(idsByTable, "memos");
  if (folderIds.size) {
    const memos = await db.memos
      .filter((memo) =>
        memo.user_id === userId
        && Boolean(memo.folder_id)
        && folderIds.has(String(memo.folder_id))
        && !deletedMemoIds.has(memo.id)
      )
      .toArray();
    for (const memo of memos) {
      const updated = { ...memo, ...syncFields(memo), folder_id: null };
      await db.memos.put(updated);
      await putQueueItem("memos", updated.id);
    }
  }
}

async function releaseRemoteReferencesForHardDeletes(userId: string, idsByTable: Map<SyncTableName, Set<string>>) {
  if (!supabase) throw new Error("云端服务尚未配置");
  const eventIds = [...idsFor(idsByTable, "events")];
  if (eventIds.length) {
    const result = await supabase
      .from("focus_sessions")
      .update({ linked_event_id: null })
      .eq("user_id", userId)
      .in("linked_event_id", eventIds);
    if (result.error) throw new Error(`专注记录解除关联失败：${result.error.message}`);
  }

  const folderIds = [...idsFor(idsByTable, "memoFolders")];
  if (folderIds.length) {
    const result = await supabase
      .from("memos")
      .update({ folder_id: null })
      .eq("user_id", userId)
      .in("folder_id", folderIds);
    if (result.error) throw new Error(`备忘录文件夹解除关联失败：${result.error.message}`);
  }
}

async function deleteRemoteRecordsById(userId: string, idsByTable: Map<SyncTableName, Set<string>>): Promise<number> {
  if (!supabase) throw new Error("云端服务尚未配置");
  let deleted = 0;
  await releaseRemoteReferencesForHardDeletes(userId, idsByTable);
  for (const config of DELETE_TABLES) {
    const ids = [...idsFor(idsByTable, config.local)];
    if (!ids.length) continue;
    const result = await supabase.from(config.remote).delete().eq("user_id", userId).in("id", ids);
    if (result.error) throw new Error(`${config.remote} 删除失败：${result.error.message}`);
    deleted += ids.length;
  }
  return deleted;
}

export async function purgeLocalSoftDeletedRecords(userId: string): Promise<number> {
  const recordsByTable = new Map<SyncTableName, Record<string, unknown>[]>();
  for (const { local } of TABLES) {
    const records = await db.table(local).filter((record) => record.user_id === userId).toArray();
    recordsByTable.set(local, records);
  }
  const idsByTable = collectHardDeleteIds(recordsByTable);
  const deleteIds = [...idsByTable.values()].flatMap((ids) => [...ids]);
  if (!deleteIds.length) return 0;

  const transactionTables = [...TABLES.map(({ local }) => db.table(local)), db.syncQueue];
  await db.transaction("rw", transactionTables, async () => {
    await releaseLocalReferencesForHardDeletes(userId, idsByTable);
    for (const config of DELETE_TABLES) {
      const ids = [...idsFor(idsByTable, config.local)];
      if (!ids.length) continue;
      for (const id of ids) {
        await putQueueItem(config.local, id, "delete");
      }
      await db.table(config.local).bulkDelete(ids);
    }
  });
  return deleteIds.length;
}

async function downloadRemoteTables(userId: string): Promise<number> {
  if (!supabase) throw new Error("云端服务尚未配置");
  let downloaded = 0;
  const recordsByTable = new Map<SyncTableName, Record<string, unknown>[]>();

  for (const config of TABLES) {
    const { data, error } = await supabase.from(config.remote).select("*").eq("user_id", userId);
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("schema cache")) {
        throw new Error("云端数据表尚未初始化，请联系管理员处理");
      }
      throw new Error(`${config.remote} 下载失败：${error.message}`);
    }
    const records = (data ?? []).map((record) => normalizeRemoteRecord(config.local, record));
    recordsByTable.set(config.local, records);
  }

  const hardDeleteIds = collectHardDeleteIds(recordsByTable);
  await deleteRemoteRecordsById(userId, hardDeleteIds);

  for (const config of TABLES) {
    const deletedIds = idsFor(hardDeleteIds, config.local);
    const activeRecords = recordsFor(recordsByTable, config.local).filter((record) => !record.deleted_at && !deletedIds.has(String(record.id)));
    const activeRemoteIds = new Set(activeRecords.map((record) => String(record.id)));
    if (activeRecords.length) {
      if (config.local === "eventOccurrenceStates") {
        const occurrenceRecords = activeRecords as unknown as EventOccurrenceState[];
        await db.transaction("rw", db.eventOccurrenceStates, db.syncQueue, async () => {
          for (const record of occurrenceRecords) {
            const localMatches = await db.eventOccurrenceStates
              .where("[event_id+occurrence_date]")
              .equals([record.event_id, record.occurrence_date])
              .filter((state) => state.user_id === userId)
              .toArray();
            for (const local of localMatches) {
              if (local.id === record.id) continue;
              const pending = await db.syncQueue
                .where("table_name")
                .equals("eventOccurrenceStates")
                .and((queuedItem) => queuedItem.record_id === local.id)
                .first();
              if (!pending) await db.eventOccurrenceStates.delete(local.id);
            }
            await db.eventOccurrenceStates.put(record);
          }
        });
      } else {
        await db.table(config.local).bulkPut(activeRecords);
      }
      downloaded += activeRecords.length;
    }
    await deleteLocalRecordsMissingFromRemote(config.local, userId, activeRemoteIds);
  }

  await deduplicateCategories(userId);
  return downloaded;
}

async function runSync(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("云端服务尚未配置");
  if (!navigator.onLine) throw new Error("当前处于离线状态");

  let uploaded = 0;
  let downloaded = 0;

  await purgeLocalSoftDeletedRecords(userId);
  await deduplicateLocalOccurrenceStates(userId);

  const queued = await db.syncQueue.orderBy("queued_at").toArray();
  const queueByTable = new Map<SyncTableName, SyncQueueItem[]>();
  for (const item of queued) {
    const items = queueByTable.get(item.table_name) ?? [];
    items.push(item);
    queueByTable.set(item.table_name, items);
  }

  const queuedDeleteIds = emptyDeleteMap();
  for (const [tableName, items] of queueByTable.entries()) {
    for (const item of items.filter((queuedItem) => queuedItem.operation === "delete")) {
      addDeleteId(queuedDeleteIds, tableName, item.record_id);
    }
  }
  await releaseRemoteReferencesForHardDeletes(userId, queuedDeleteIds);

  for (const config of DELETE_TABLES) {
    const items = queueByTable.get(config.local) ?? [];
    for (const item of items.filter((queuedItem) => queuedItem.operation === "delete")) {
      const result = await supabase.from(config.remote).delete().eq("id", item.record_id).eq("user_id", userId);
      if (result.error) {
        await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: result.error.message });
        if (result.error.code === "PGRST205" || result.error.message.includes("schema cache")) {
          throw new Error("云端数据表尚未初始化，请联系管理员处理");
        }
        throw new Error(`${config.remote} 删除失败：${result.error.message}`);
      }
      await db.syncQueue.delete(item.id);
      uploaded += 1;
    }
  }

  for (const config of TABLES) {
    const items = queueByTable.get(config.local) ?? [];
    for (const item of items.filter((queuedItem) => queuedItem.operation !== "delete")) {
      const localRecord = await db.table(config.local).get(item.record_id);
      if (!localRecord || localRecord.user_id !== userId) {
        await db.syncQueue.delete(item.id);
        continue;
      }
      const { server_updated_at: _serverUpdatedAt, ...payload } = localRecord;
      let savedRecord: Record<string, unknown> | null = null;
      let error;
      if (config.local === "eventOccurrenceStates") {
        const { data: existing, error: lookupError } = await supabase
          .from(config.remote)
          .select("id")
          .eq("user_id", userId)
          .eq("event_id", localRecord.event_id)
          .eq("occurrence_date", localRecord.occurrence_date)
          .maybeSingle();
        if (lookupError) error = lookupError;
        else {
          const canonicalPayload = {
            ...payload,
            id: existing?.id ?? localRecord.id
          };
          const result = await supabase
            .from(config.remote)
            .upsert(canonicalPayload, { onConflict: "id" })
            .select("*")
            .single();
          error = result.error;
          savedRecord = result.data;
        }
      } else {
        const result = await supabase.from(config.remote).upsert(payload, { onConflict: "id" });
        error = result.error;
      }
      if (error) {
        await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: error.message });
        if (error.code === "PGRST205" || error.message.includes("schema cache")) {
          throw new Error("云端数据表尚未初始化，请联系管理员处理");
        }
        throw new Error(`${config.remote} 上传失败：${error.message}`);
      }
      if (config.local === "eventOccurrenceStates" && savedRecord) {
        const normalized = normalizeRemoteRecord(config.local, savedRecord) as unknown as EventOccurrenceState;
        await db.transaction("rw", db.eventOccurrenceStates, db.syncQueue, async () => {
          if (savedRecord.id !== localRecord.id) {
            await db.eventOccurrenceStates.delete(localRecord.id);
            const duplicateQueueItems = await db.syncQueue
              .where("table_name")
              .equals("eventOccurrenceStates")
              .and((queuedItem) => queuedItem.record_id === localRecord.id)
              .toArray();
            await db.syncQueue.bulkDelete(duplicateQueueItems.map((queuedItem) => queuedItem.id));
          }
          await db.eventOccurrenceStates.put(normalized);
        });
      }
      await db.syncQueue.delete(item.id);
      uploaded += 1;
    }
  }

  downloaded = await downloadRemoteTables(userId);

  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded, downloaded, completed_at: completedAt };
}

async function deleteLocalRecordsMissingFromRemote(tableName: SyncTableName, userId: string, activeRemoteIds: Set<string>) {
  const queuedItems = await db.syncQueue.where("table_name").equals(tableName).toArray();
  const pendingIds = new Set(queuedItems.map((item) => item.record_id));
  const localRecords = await db.table(tableName).filter((record) => record.user_id === userId).toArray();
  const staleIds = localRecords
    .filter((record) => !activeRemoteIds.has(String(record.id)) && !pendingIds.has(String(record.id)))
    .map((record) => String(record.id));
  if (staleIds.length) await db.table(tableName).bulkDelete(staleIds);
}

export async function pullRemoteNow(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("云端服务尚未配置");
  if (!navigator.onLine) throw new Error("当前处于离线状态");
  const downloaded = await downloadRemoteTables(userId);
  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded: 0, downloaded, completed_at: completedAt };
}

export function syncNow(userId: string): Promise<SyncResult> {
  if (!activeSync) {
    activeSync = runSync(userId).finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}

export function getLastSync(userId: string): string | null {
  return localStorage.getItem(`semester-schedule-last-sync:${userId}`);
}
