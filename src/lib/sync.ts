import { db } from "../db";
import type { EventOccurrenceState, SyncQueueItem, SyncTableName } from "../types";
import { deduplicateCategories } from "./categories";
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

function queueRecord(table_name: SyncTableName, record_id: string): SyncQueueItem {
  return {
    id: crypto.randomUUID(),
    table_name,
    record_id,
    operation: "upsert",
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  };
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

async function downloadRemoteTables(userId: string): Promise<number> {
  if (!supabase) throw new Error("Supabase 尚未配置");
  let downloaded = 0;

  for (const config of TABLES) {
    const { data, error } = await supabase.from(config.remote).select("*").eq("user_id", userId);
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("schema cache")) {
        throw new Error("Supabase 数据表尚未初始化，请先执行 schema.sql");
      }
      throw new Error(`${config.remote} 下载失败：${error.message}`);
    }
    const records = (data ?? []).map((record) => normalizeRemoteRecord(config.local, record));
    if (records.length) {
      if (config.local === "eventOccurrenceStates") {
        const occurrenceRecords = records as unknown as EventOccurrenceState[];
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
        await db.table(config.local).bulkPut(records);
      }
      downloaded += records.length;
    }
  }

  await deduplicateCategories(userId);
  return downloaded;
}

async function runSync(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("Supabase 尚未配置");
  if (!navigator.onLine) throw new Error("当前处于离线状态");

  let uploaded = 0;
  let downloaded = 0;

  await deduplicateLocalOccurrenceStates(userId);

  const queued = await db.syncQueue.orderBy("queued_at").toArray();
  const queueByTable = new Map<SyncTableName, SyncQueueItem[]>();
  for (const item of queued) {
    const items = queueByTable.get(item.table_name) ?? [];
    items.push(item);
    queueByTable.set(item.table_name, items);
  }

  for (const config of TABLES) {
    const items = queueByTable.get(config.local) ?? [];
    for (const item of items) {
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
          throw new Error("Supabase 数据表尚未初始化，请先执行 schema.sql");
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

export async function pullRemoteNow(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("Supabase 尚未配置");
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
