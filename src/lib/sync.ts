import { db } from "../db";
import type { EventOccurrenceState, SyncQueueItem, SyncTableName } from "../types";
import { deduplicateCategories } from "./categories";
import { syncFields } from "./identity";
import { deduplicateLocalOccurrenceStates } from "./occurrenceStates";
import { normalizeMemoImages } from "./memoImages";
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
  { local: "focusSessions", remote: "focus_sessions", label: "专注记录" },
  { local: "restSessions", remote: "rest_sessions", label: "休息记录" },
  { local: "healthProfiles", remote: "health_profiles", label: "健康设置" },
  { local: "healthLogs", remote: "health_logs", label: "健康记录" }
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
  "restSessions",
  "healthLogs",
  "healthProfiles",
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
  // 下载时因本地有未上传编辑（待传队列或本地 updated_at 更晚）而被保留、未被云端覆盖的记录数
  kept_local: number;
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
      is_pinned: Boolean(record.is_pinned),
      images: normalizeMemoImages(record.images)
    };
  }
  if (table === "healthProfiles") {
    return {
      ...record,
      height_cm: record.height_cm == null ? null : Number(record.height_cm),
      daily_water_goal_ml: Number(record.daily_water_goal_ml ?? 2000),
      exercise_items: normalizeExerciseItems(record.exercise_items),
      movement_reminder_enabled: Boolean(record.movement_reminder_enabled),
      movement_interval_minutes: Number(record.movement_interval_minutes ?? 60),
      reminder_start_time: String(record.reminder_start_time ?? "09:00").slice(0, 5),
      reminder_end_time: String(record.reminder_end_time ?? "22:00").slice(0, 5)
    };
  }
  if (table === "healthLogs") {
    return {
      ...record,
      amount: Number(record.amount ?? 0),
      activity: record.activity == null ? null : String(record.activity),
      note: String(record.note ?? "")
    };
  }
  if (table === "focusSettings") {
    return {
      ...record,
      pomodoro_minutes: Number(record.pomodoro_minutes ?? 25),
      pomodoro_rounds: Number(record.pomodoro_rounds ?? 4),
      short_break_minutes: Number(record.short_break_minutes ?? 5),
      long_break_minutes: Number(record.long_break_minutes ?? 15),
      long_break_interval: Number(record.long_break_interval ?? 4),
      auto_start_break: record.auto_start_break !== false,
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
      interrupted: Boolean(record.interrupted),
      pomodoro_plan_id: record.pomodoro_plan_id ?? null,
      pomodoro_round: record.pomodoro_round == null ? null : Number(record.pomodoro_round)
    };
  }
  if (table === "restSessions") {
    return {
      ...record,
      planned_seconds: Number(record.planned_seconds ?? 0),
      duration_seconds: Number(record.duration_seconds ?? 0),
      completed: Boolean(record.completed),
      interrupted: Boolean(record.interrupted),
      rest_kind: record.rest_kind == null ? "manual" : String(record.rest_kind),
      pomodoro_plan_id: record.pomodoro_plan_id ?? null,
      pomodoro_round: record.pomodoro_round == null ? null : Number(record.pomodoro_round)
    };
  }
  return record;
}

function normalizeExerciseItems(value: unknown): string[] {
  if (!Array.isArray(value)) return ["俯卧撑", "仰卧起坐", "深蹲"];
  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 12);
  return items.length ? [...new Set(items)] : ["俯卧撑", "仰卧起坐", "深蹲"];
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

const REMOTE_PAGE_SIZE = 1000;

interface RemoteTableFetch {
  rows: Record<string, unknown>[];
  complete: boolean;
}

async function fetchRemoteTableRows(remote: string, userId: string): Promise<RemoteTableFetch> {
  if (!supabase) throw new Error("云端服务尚未配置");
  const rows: Record<string, unknown>[] = [];
  let total: number | null = null;
  for (;;) {
    const from = rows.length;
    const { data, error, count } = await supabase
      .from(remote)
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + REMOTE_PAGE_SIZE - 1);
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("schema cache")) {
        throw new Error("云端数据表尚未初始化，请联系管理员处理");
      }
      throw new Error(`${remote} 下载失败：${error.message}`);
    }
    if (typeof count === "number") total = count;
    const page = data ?? [];
    rows.push(...page);
    if (!page.length) break;
    if (total != null && rows.length >= total) break;
    // 没有 count 时无法区分“已到末尾”和“被服务端截断”，保守停止并按不完整处理
    if (total == null && page.length < REMOTE_PAGE_SIZE) break;
  }
  return { rows, complete: total != null && rows.length >= total };
}

interface DownloadResult {
  downloaded: number;
  kept: number;
}

async function downloadRemoteTables(userId: string): Promise<DownloadResult> {
  if (!supabase) throw new Error("云端服务尚未配置");
  let downloaded = 0;
  let kept = 0;
  const recordsByTable = new Map<SyncTableName, Record<string, unknown>[]>();
  const incompleteTables = new Set<SyncTableName>();

  for (const config of TABLES) {
    const { rows, complete } = await fetchRemoteTableRows(config.remote, userId);
    if (!complete) incompleteTables.add(config.local);
    recordsByTable.set(config.local, rows.map((record) => normalizeRemoteRecord(config.local, record)));
  }

  const hardDeleteIds = collectHardDeleteIds(recordsByTable);
  await deleteRemoteRecordsById(userId, hardDeleteIds);

  for (const config of TABLES) {
    const deletedIds = idsFor(hardDeleteIds, config.local);
    const activeRecords = recordsFor(recordsByTable, config.local).filter((record) => !record.deleted_at && !deletedIds.has(String(record.id)));
    const activeRemoteIds = new Set(activeRecords.map((record) => String(record.id)));
    // 保护本地未上传的编辑：待传队列中的记录、以及本地 updated_at 更晚的记录，下载时不被云端覆盖。
    // 服务端触发器已按 updated_at 做上传侧后写覆盖保护；这里补齐下载/拉取侧，避免纯拉取或同步中途的本地编辑被静默冲掉。
    const pendingIds = await pendingUpsertIds(config.local);
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
            if (pendingIds.has(String(record.id)) || localMatches.some((state) => pendingIds.has(String(state.id)))) {
              kept += 1;
              continue;
            }
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
            downloaded += 1;
          }
        });
      } else {
        const localRecords = await db.table(config.local).filter((record) => record.user_id === userId).toArray();
        const localById = new Map(localRecords.map((record) => [String(record.id), record]));
        const applyRecords = activeRecords.filter((record) => {
          const id = String(record.id);
          if (pendingIds.has(id)) return false;
          const local = localById.get(id);
          if (local && String(local.updated_at) > String(record.updated_at)) return false;
          return true;
        });
        kept += activeRecords.length - applyRecords.length;
        if (applyRecords.length) await db.table(config.local).bulkPut(applyRecords);
        downloaded += applyRecords.length;
      }
    }
    // 拉取不完整时跳过镜像删除，避免把云端仍存在的记录误删本地
    if (!incompleteTables.has(config.local)) {
      await deleteLocalRecordsMissingFromRemote(config.local, userId, activeRemoteIds);
    }
  }

  await deduplicateCategories(userId);
  return { downloaded, kept };
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
    const pending = items.filter((queuedItem) => queuedItem.operation !== "delete");

    // Collect local records, discarding any that no longer exist or belong to another user.
    const validItems: { item: SyncQueueItem; record: Record<string, unknown> }[] = [];
    for (const item of pending) {
      const localRecord = await db.table(config.local).get(item.record_id);
      if (!localRecord || localRecord.user_id !== userId) {
        await db.syncQueue.delete(item.id);
        continue;
      }
      validItems.push({ item, record: localRecord });
    }
    if (!validItems.length) continue;

    // eventOccurrenceStates needs a per-record lookup to resolve ID conflicts — process them
    // individually but in a batch-friendly way: fetch all existing IDs in one query first.
    if (config.local === "eventOccurrenceStates") {
      const pairs = validItems.map(({ record }) => ({ event_id: record.event_id, occurrence_date: record.occurrence_date }));
      const { data: existingRows } = await supabase
        .from(config.remote)
        .select("id, event_id, occurrence_date")
        .eq("user_id", userId)
        .or(pairs.map((p) => `event_id.eq.${p.event_id},occurrence_date.eq.${p.occurrence_date}`).join(","));
      const existingMap = new Map<string, string>();
      for (const row of existingRows ?? []) {
        existingMap.set(`${row.event_id}::${row.occurrence_date}`, row.id);
      }

      const batchPayload: Record<string, unknown>[] = [];
      for (const { item, record } of validItems) {
        const { server_updated_at: _serverUpdatedAt, ...payload } = record;
        const compositeKey = `${record.event_id}::${record.occurrence_date}`;
        batchPayload.push({ ...payload, id: existingMap.get(compositeKey) ?? record.id });
      }
      const { error } = await supabase.from(config.remote).upsert(batchPayload, { onConflict: "id" });
      if (error) {
        for (const { item } of validItems) {
          await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: error.message });
        }
        if (error.code === "PGRST205" || error.message.includes("schema cache")) {
          throw new Error("云端数据表尚未初始化，请联系管理员处理");
        }
        throw new Error(`${config.remote} 上传失败：${error.message}`);
      }
      for (const { item } of validItems) {
        await db.syncQueue.delete(item.id);
        uploaded += 1;
      }
      continue;
    }

    // All other tables: batch upsert in a single request (Supabase supports arrays natively).
    const payloads = validItems.map(({ record }) => {
      const { server_updated_at: _serverUpdatedAt, ...payload } = record;
      return payload;
    });
    const { error } = await supabase.from(config.remote).upsert(payloads, { onConflict: "id" });
    if (error) {
      for (const { item } of validItems) {
        await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: error.message });
      }
      if (error.code === "PGRST205" || error.message.includes("schema cache")) {
        throw new Error("云端数据表尚未初始化，请联系管理员处理");
      }
      throw new Error(`${config.remote} 上传失败：${error.message}`);
    }
    for (const { item } of validItems) {
      await db.syncQueue.delete(item.id);
      uploaded += 1;
    }
  }

  const download = await downloadRemoteTables(userId);
  downloaded = download.downloaded;

  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded, downloaded, kept_local: download.kept, completed_at: completedAt };
}

async function pendingUpsertIds(tableName: SyncTableName): Promise<Set<string>> {
  const items = await db.syncQueue.where("table_name").equals(tableName).toArray();
  return new Set(items.filter((item) => item.operation !== "delete").map((item) => String(item.record_id)));
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
  const { downloaded, kept } = await downloadRemoteTables(userId);
  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded: 0, downloaded, kept_local: kept, completed_at: completedAt };
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
