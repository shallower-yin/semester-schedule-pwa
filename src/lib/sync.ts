import Dexie from "dexie";
import { db, queueChange } from "../db";
import type { EventOccurrenceState, SyncQueueItem, SyncTableName } from "../types";
import { deduplicateCategories } from "./categories";
import { getCurrentUserId, syncFields } from "./identity";
import { deduplicateLocalOccurrenceStates } from "./occurrenceStates";
import { supabase } from "./supabase";
import { normalizeRemoteRecord, normalizeUploadPayload, recoverLunarAnniversary } from "./syncRecordTransforms";

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
  { local: "todos", remote: "todos", label: "待办" },
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
  "todos",
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

export async function getSyncHealth(ownerId = getCurrentUserId()): Promise<SyncHealth> {
  const queued = await db.syncQueue.where("owner_id").equals(ownerId).sortBy("queued_at");
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

const activeSyncs = new Map<string, Promise<SyncResult>>();

interface CompactedSyncQueue {
  items: SyncQueueItem[];
  duplicateIds: string[];
}

export function compactSyncQueueItems(items: SyncQueueItem[]): CompactedSyncQueue {
  const retainedByRecord = new Map<string, SyncQueueItem>();
  const duplicateIds: string[] = [];
  for (const item of items) {
    const key = `${item.owner_id}::${item.table_name}::${item.record_id}`;
    const retained = retainedByRecord.get(key);
    if (!retained) {
      retainedByRecord.set(key, item);
      continue;
    }
    const itemIsNewer = item.queued_at > retained.queued_at
      || (item.queued_at === retained.queued_at && item.operation === "delete" && retained.operation !== "delete");
    if (itemIsNewer) {
      duplicateIds.push(retained.id);
      retainedByRecord.set(key, item);
    } else {
      duplicateIds.push(item.id);
    }
  }
  return { items: Array.from(retainedByRecord.values()), duplicateIds };
}

function uniquePayloadsById(payloads: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const payload of payloads) byId.set(String(payload.id), payload);
  return Array.from(byId.values());
}

function queueRecord(owner_id: string, table_name: SyncTableName, record_id: string, operation: "upsert" | "delete" = "upsert"): SyncQueueItem {
  return {
    id: crypto.randomUUID(),
    owner_id,
    table_name,
    record_id,
    operation,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  };
}

async function putQueueItem(owner_id: string, table_name: SyncTableName, record_id: string, operation: "upsert" | "delete" = "upsert") {
  await queueChange(table_name, record_id, operation, owner_id);
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
          .where("[owner_id+table_name+record_id]")
          .equals(["local", local, record.id])
          .first();
        if (existingQueue) {
          await db.syncQueue.put({ ...existingQueue, owner_id: userId, queued_at: new Date().toISOString() });
        } else {
          await db.syncQueue.put(queueRecord(userId, local, record.id));
        }
        adopted += 1;
      }
    }
  });
  return adopted;
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
  const categoryIds = idsFor(idsByTable, "categories");
  const deletedEventIds = idsFor(idsByTable, "events");
  if (categoryIds.size) {
    const events = await db.events.filter((event) => event.user_id === userId
      && Boolean(event.category_id) && categoryIds.has(String(event.category_id)) && !deletedEventIds.has(event.id)).toArray();
    for (const event of events) {
      const updated = { ...event, ...syncFields(event), deleted_at: event.deleted_at, category_id: null };
      await db.events.put(updated);
      await putQueueItem(userId, "events", updated.id);
    }
  }
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
      await putQueueItem(userId, "focusSessions", updated.id);
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
      await putQueueItem(userId, "memos", updated.id);
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
        await putQueueItem(userId, config.local, id, "delete");
      }
      await db.table(config.local).bulkDelete(ids);
    }
  });
  return deleteIds.length;
}

const REMOTE_PAGE_SIZE = 1000;
const REMOTE_DOWNLOAD_CONCURRENCY = 4;
const REMOTE_RECORD_BATCH_SIZE = 100;
const REMOTE_REVISION_COLUMNS = "id, version, updated_at, server_updated_at, deleted_at";
const OCCURRENCE_LOOKUP_BATCH_SIZE = 100;

export function occurrenceLookupFilters(
  pairs: Array<{ event_id: unknown; occurrence_date: unknown }>,
  batchSize = OCCURRENCE_LOOKUP_BATCH_SIZE
): string[] {
  const uniquePairs = [...new Map(
    pairs.map((pair) => [
      `${String(pair.event_id)}::${String(pair.occurrence_date)}`,
      { event_id: String(pair.event_id), occurrence_date: String(pair.occurrence_date) }
    ])
  ).values()];
  const filters: string[] = [];
  for (let index = 0; index < uniquePairs.length; index += Math.max(1, batchSize)) {
    filters.push(uniquePairs
      .slice(index, index + Math.max(1, batchSize))
      .map((pair) => `and(event_id.eq.${pair.event_id},occurrence_date.eq.${pair.occurrence_date})`)
      .join(","));
  }
  return filters;
}

interface RemoteTableFetch {
  rows: Record<string, unknown>[];
  complete: boolean;
}

async function fetchRemoteTableRows(
  remote: string,
  userId: string,
  options: { columns?: string; ids?: string[] } = {}
): Promise<RemoteTableFetch> {
  if (!supabase) throw new Error("云端服务尚未配置");
  const rows: Record<string, unknown>[] = [];
  let total: number | null = null;
  for (;;) {
    const from = rows.length;
    let query = supabase
      .from(remote)
      .select(options.columns ?? "*", { count: "exact" })
      .eq("user_id", userId);
    if (options.ids) query = query.in("id", options.ids);
    const { data, error, count } = await query
      .order("id", { ascending: true })
      .range(from, from + REMOTE_PAGE_SIZE - 1)
      .overrideTypes<Record<string, unknown>[], { merge: false }>();
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

interface RemoteTableDownload extends RemoteTableFetch {
  activeIds: Set<string>;
  comparedVersions: boolean;
}

async function fetchRemoteTableChanges(
  config: typeof TABLES[number],
  userId: string,
  compareVersions: boolean
): Promise<RemoteTableDownload> {
  const localRecords: Record<string, unknown>[] = compareVersions
    ? await db.table(config.local).filter((record) => record.user_id === userId).toArray()
    : [];
  if (!localRecords.length) {
    const result = await fetchRemoteTableRows(config.remote, userId);
    return {
      ...result,
      activeIds: new Set(result.rows.filter((row) => !row.deleted_at).map((row) => String(row.id))),
      comparedVersions: false
    };
  }

  // Hard deletions leave no row or change log. Compare the complete ID/revision
  // list, then request bodies only for new or changed records.
  const manifest = await fetchRemoteTableRows(config.remote, userId, { columns: REMOTE_REVISION_COLUMNS });
  const localById = new Map(localRecords.map((record) => [String(record.id), record]));
  const changedIds = manifest.rows.filter((remote) => {
    const local = localById.get(String(remote.id));
    return !local || remote.deleted_at || !remote.server_updated_at
      || remote.server_updated_at !== local.server_updated_at
      || String(remote.version) !== String(local.version)
      || remote.updated_at !== local.updated_at;
  }).map((record) => String(record.id));
  const activeIds = new Set(manifest.rows.filter((row) => !row.deleted_at).map((row) => String(row.id)));
  const rows: Record<string, unknown>[] = [];
  let complete = manifest.complete;
  for (let index = 0; index < changedIds.length; index += REMOTE_RECORD_BATCH_SIZE) {
    const ids = changedIds.slice(index, index + REMOTE_RECORD_BATCH_SIZE);
    const result = await fetchRemoteTableRows(config.remote, userId, { ids });
    rows.push(...result.rows);
    complete = complete && result.complete;
    if (result.complete) {
      const returnedIds = new Set(result.rows.map((row) => String(row.id)));
      for (const id of ids) {
        if (!returnedIds.has(id)) activeIds.delete(id);
      }
    }
  }
  return { rows, complete, activeIds, comparedVersions: true };
}

interface DownloadResult {
  downloaded: number;
  kept: number;
}

async function downloadRemoteTables(userId: string, compareVersions = false): Promise<DownloadResult> {
  if (!supabase) throw new Error("云端服务尚未配置");
  let downloaded = 0;
  let kept = 0;
  const recordsByTable = new Map<SyncTableName, Record<string, unknown>[]>();
  const incompleteTables = new Set<SyncTableName>();
  const activeIdsByTable = new Map<SyncTableName, Set<string>>();
  const comparedTables = new Set<SyncTableName>();

  // Fetch independent tables together; keep uploads and local merges in dependency order.
  // Settle each batch before propagating an error so no reads outlive a failed sync.
  const fetchTables = async (tables: typeof TABLES, compare: boolean) => {
    for (let index = 0; index < tables.length; index += REMOTE_DOWNLOAD_CONCURRENCY) {
      const batch = tables.slice(index, index + REMOTE_DOWNLOAD_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((config) => fetchRemoteTableChanges(config, userId, compare)));
      for (const [offset, result] of results.entries()) {
        if (result.status === "rejected") throw result.reason;
        const config = batch[offset];
        const { rows, complete, activeIds, comparedVersions } = result.value;
        if (!complete) incompleteTables.add(config.local);
        else incompleteTables.delete(config.local);
        if (comparedVersions) comparedTables.add(config.local);
        else comparedTables.delete(config.local);
        activeIdsByTable.set(config.local, activeIds);
        recordsByTable.set(config.local, rows.map((record) => normalizeRemoteRecord(config.local, record)));
      }
    }
  };
  await fetchTables(TABLES, compareVersions);

  // Legacy soft deletions require the full relationship graph for their existing
  // cascade cleanup. Ordinary hard-deletion sync only needs the ID manifest.
  if ([...recordsByTable.values()].some((rows) => rows.some((record) => record.deleted_at))) {
    await fetchTables(TABLES.filter((config) => comparedTables.has(config.local)), false);
  }

  const hardDeleteIds = collectHardDeleteIds(recordsByTable);
  await deleteRemoteRecordsById(userId, hardDeleteIds);

  for (const config of TABLES) {
    const deletedIds = idsFor(hardDeleteIds, config.local);
    const activeRecords = recordsFor(recordsByTable, config.local).filter((record) => !record.deleted_at && !deletedIds.has(String(record.id)));
    const activeRemoteIds = new Set([...(activeIdsByTable.get(config.local) ?? [])].filter((id) => !deletedIds.has(id)));
    // 保护本地未上传的编辑：待传队列中的记录、以及本地 updated_at 更晚的记录，下载时不被云端覆盖。
    // 队列复查、云端合并和镜像删除必须与本地“写记录+入队”争用同一组
    // Dexie 表事务；这样用户在下载期间编辑时，要么先被本事务看到，要么在
    // 本事务之后写回更新，不会落入读取旧队列后再覆盖新编辑的窗口。
    await db.transaction("rw", db.table(config.local), db.syncQueue, async () => {
      const pendingIds = await pendingChangeIds(config.local, userId);
      if (activeRecords.length && config.local === "eventOccurrenceStates") {
        const occurrenceRecords = activeRecords as unknown as EventOccurrenceState[];
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
              .where("[owner_id+table_name+record_id]")
              .equals([userId, "eventOccurrenceStates", local.id])
              .first();
            if (!pending) await db.eventOccurrenceStates.delete(local.id);
          }
          await db.eventOccurrenceStates.put(record);
          downloaded += 1;
        }
      } else if (activeRecords.length) {
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
      // 拉取不完整时跳过镜像删除，避免把云端仍存在的记录误删本地。
      if (!incompleteTables.has(config.local)) {
        await deleteLocalRecordsMissingFromRemote(config.local, userId, activeRemoteIds);
      }
    });
  }

  await deduplicateCategories(userId);
  // Repair after merging the latest cloud revisions, so a legacy local cache
  // cannot overwrite a newer edit on another device. Queue the correction via
  // the same transaction as the row; the normal sync retry persists it online.
  await db.transaction("rw", db.anniversaries, db.syncQueue, async () => {
    const anniversaries = await db.anniversaries.filter((record) => record.user_id === userId).toArray();
    const pendingIds = await pendingChangeIds("anniversaries", userId);
    for (const anniversary of anniversaries) {
      if (pendingIds.has(anniversary.id)) continue;
      const repaired = recoverLunarAnniversary(anniversary as unknown as Record<string, unknown>);
      if (!repaired) continue;
      await db.anniversaries.put({ ...repaired, ...syncFields(anniversary) } as unknown as typeof anniversary);
      await putQueueItem(userId, "anniversaries", anniversary.id);
    }
  });
  return { downloaded, kept };
}

async function runSync(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("云端服务尚未配置");
  if (!navigator.onLine) throw new Error("当前处于离线状态");

  let uploaded = 0;
  let downloaded = 0;

  await purgeLocalSoftDeletedRecords(userId);
  await deduplicateLocalOccurrenceStates(userId);

  const queuedRows = await db.syncQueue.where("owner_id").equals(userId).sortBy("queued_at");
  const compactedQueue = compactSyncQueueItems(queuedRows);
  if (compactedQueue.duplicateIds.length) {
    await db.syncQueue.bulkDelete(compactedQueue.duplicateIds);
  }
  const queued = compactedQueue.items;
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

    if (config.local === "focusSessions") {
      await releaseLocalMissingEventReferences(userId, validItems.map(({ record }) => record));
    }

    // eventOccurrenceStates needs a per-record lookup to resolve ID conflicts — process them
    // in bounded exact-pair batches so PostgREST cannot turn the lookup into a broad
    // event/date cross-product or truncate the canonical row at its response limit.
    if (config.local === "eventOccurrenceStates") {
      const pairs = validItems.map(({ record }) => ({ event_id: record.event_id, occurrence_date: record.occurrence_date }));
      const existingMap = new Map<string, string>();
      for (const filter of occurrenceLookupFilters(pairs)) {
        const { data: existingRows, error: lookupError } = await supabase
          .from(config.remote)
          .select("id, event_id, occurrence_date")
          .eq("user_id", userId)
          .or(filter);
        if (lookupError) {
          for (const { item } of validItems) {
            await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: lookupError.message });
          }
          throw new Error(`${config.remote} 查重失败：${lookupError.message}`);
        }
        for (const row of existingRows ?? []) {
          existingMap.set(`${row.event_id}::${row.occurrence_date}`, row.id);
        }
      }

      const batchPayload: Record<string, unknown>[] = [];
      for (const { item, record } of validItems) {
        const payload = normalizeUploadPayload(config.local, record);
        const compositeKey = `${record.event_id}::${record.occurrence_date}`;
        batchPayload.push({ ...payload, id: existingMap.get(compositeKey) ?? record.id });
      }
      const uniqueBatchPayload = uniquePayloadsById(batchPayload);
      const { error } = await supabase.from(config.remote).upsert(uniqueBatchPayload, { onConflict: "id" });
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
      }
      uploaded += uniqueBatchPayload.length;
      continue;
    }

    // All other tables: batch upsert in a single request (Supabase supports arrays natively).
    const payloads = uniquePayloadsById(validItems.map(({ record }) => normalizeUploadPayload(config.local, record)));
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
    }
    uploaded += payloads.length;
  }

  const download = await downloadRemoteTables(userId, true);
  downloaded = download.downloaded;

  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded, downloaded, kept_local: download.kept, completed_at: completedAt };
}

async function pendingChangeIds(tableName: SyncTableName, ownerId: string): Promise<Set<string>> {
  const items = await db.syncQueue
    .where("[owner_id+table_name+record_id]")
    .between([ownerId, tableName, Dexie.minKey], [ownerId, tableName, Dexie.maxKey])
    .toArray();
  // Pending deletions also win over a remote row until their upload completes.
  return new Set(items.map((item) => String(item.record_id)));
}

async function deleteLocalRecordsMissingFromRemote(tableName: SyncTableName, userId: string, activeRemoteIds: Set<string>) {
  const queuedItems = await db.syncQueue
    .where("[owner_id+table_name+record_id]")
    .between([userId, tableName, Dexie.minKey], [userId, tableName, Dexie.maxKey])
    .toArray();
  const pendingIds = new Set(queuedItems.map((item) => item.record_id));
  const localRecords = await db.table(tableName).filter((record) => record.user_id === userId).toArray();
  const staleIds = localRecords
    .filter((record) => !activeRemoteIds.has(String(record.id)) && !pendingIds.has(String(record.id)))
    .map((record) => String(record.id));
  if (staleIds.length) await db.table(tableName).bulkDelete(staleIds);
}

async function releaseLocalMissingEventReferences(userId: string, records: Record<string, unknown>[]): Promise<void> {
  const linkedIds = [...new Set(records.map((record) => String(record.linked_event_id ?? "")).filter(Boolean))];
  if (!linkedIds.length) return;
  const events = await db.events.bulkGet(linkedIds);
  const validEventIds = new Set(
    events
      .filter((event): event is NonNullable<typeof event> =>
        Boolean(event && event.user_id === userId && !event.deleted_at)
      )
      .map((event) => event.id)
  );
  for (const record of records) {
    const linkedId = String(record.linked_event_id ?? "");
    if (!linkedId || validEventIds.has(linkedId)) continue;
    const local = await db.focusSessions.get(String(record.id));
    if (!local) {
      record.linked_event_id = null;
      continue;
    }
    const updated = { ...local, ...syncFields(local), linked_event_id: null };
    await db.focusSessions.put(updated);
    Object.assign(record, updated);
  }
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
  const current = activeSyncs.get(userId);
  if (current) return current;
  const next = runSync(userId).finally(() => {
    if (activeSyncs.get(userId) === next) {
      activeSyncs.delete(userId);
    }
  });
  activeSyncs.set(userId, next);
  return next;
}

export function getLastSync(userId: string): string | null {
  return localStorage.getItem(`semester-schedule-last-sync:${userId}`);
}
