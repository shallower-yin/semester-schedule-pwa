import { db } from "../db";
import type { SyncQueueItem, SyncTableName } from "../types";
import { supabase } from "./supabase";

const TABLES: Array<{ local: SyncTableName; remote: string }> = [
  { local: "semesters", remote: "semesters" },
  { local: "categories", remote: "categories" },
  { local: "classPeriods", remote: "class_periods" },
  { local: "courses", remote: "courses" },
  { local: "courseSchedules", remote: "course_schedules" },
  { local: "courseCancellations", remote: "course_cancellations" },
  { local: "events", remote: "events" },
  { local: "eventOccurrenceStates", remote: "event_occurrence_states" }
];

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
        const existingQueue = await db.syncQueue.where({ table_name: local, record_id: record.id }).first();
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
      start_time: String(record.start_time).slice(0, 5),
      end_time: String(record.end_time).slice(0, 5)
    };
  }
  if (table === "events") {
    return {
      ...record,
      start_time: record.start_time ? String(record.start_time).slice(0, 5) : null,
      end_time: record.end_time ? String(record.end_time).slice(0, 5) : null
    };
  }
  return record;
}

async function runSync(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error("Supabase 尚未配置");
  if (!navigator.onLine) throw new Error("当前处于离线状态");

  let uploaded = 0;
  let downloaded = 0;

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
      const { error } = await supabase.from(config.remote).upsert(payload, { onConflict: "id" });
      if (error) {
        await db.syncQueue.update(item.id, { attempts: item.attempts + 1, last_error: error.message });
        if (error.code === "PGRST205" || error.message.includes("schema cache")) {
          throw new Error("Supabase 数据表尚未初始化，请先执行 schema.sql");
        }
        throw new Error(`${config.remote} 上传失败：${error.message}`);
      }
      await db.syncQueue.delete(item.id);
      uploaded += 1;
    }
  }

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
      await db.table(config.local).bulkPut(records);
      downloaded += records.length;
    }
  }

  const completedAt = new Date().toISOString();
  localStorage.setItem(`semester-schedule-last-sync:${userId}`, completedAt);
  return { uploaded, downloaded, completed_at: completedAt };
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
