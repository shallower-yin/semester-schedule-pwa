import Dexie from "dexie";
import { db } from "../db";
import type { BackupFile, LocalBackupSnapshot } from "../types";
import { BACKUP_TABLES, createBackup } from "./backup";
import { backupIsDue, markBackupCompleted } from "./backupStatus";

export const AUTO_BACKUP_KEEP_LIMIT = 3;

const scheduledBackupPromises = new Map<string, Promise<LocalBackupSnapshot | null>>();

export function countBackupRecords(backup: BackupFile): number {
  return BACKUP_TABLES.reduce((sum, tableName) => sum + backup.data[tableName].length, 0);
}

export async function createLocalBackupSnapshot(
  ownerId: string,
  reason: LocalBackupSnapshot["reason"] = "scheduled",
  now = new Date()
): Promise<LocalBackupSnapshot> {
  const backup = await createBackup(ownerId);
  backup.exported_at = now.toISOString();
  const snapshot: LocalBackupSnapshot = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    created_at: now.toISOString(),
    reason,
    record_count: countBackupRecords(backup),
    backup
  };

  await db.localBackupSnapshots.put(snapshot);
  await trimLocalBackupSnapshots(ownerId);
  markBackupCompleted(now, ownerId);
  return snapshot;
}

export async function ensureScheduledLocalBackup(ownerId: string, now = new Date()): Promise<LocalBackupSnapshot | null> {
  if (!backupIsDue(now, ownerId)) return null;
  const existing = scheduledBackupPromises.get(ownerId);
  if (existing) return existing;
  const scheduled = createLocalBackupSnapshot(ownerId, "scheduled", now).finally(() => {
      scheduledBackupPromises.delete(ownerId);
    });
  scheduledBackupPromises.set(ownerId, scheduled);
  return scheduled;
}

export async function getLatestLocalBackupSnapshot(ownerId: string): Promise<LocalBackupSnapshot | undefined> {
  return db.localBackupSnapshots
    .where("[owner_id+created_at]")
    .between([ownerId, Dexie.minKey], [ownerId, Dexie.maxKey])
    .reverse()
    .first();
}

async function trimLocalBackupSnapshots(ownerId: string): Promise<void> {
  const snapshots = await db.localBackupSnapshots
    .where("[owner_id+created_at]")
    .between([ownerId, Dexie.minKey], [ownerId, Dexie.maxKey])
    .reverse()
    .toArray();
  const stale = snapshots.slice(AUTO_BACKUP_KEEP_LIMIT);
  if (stale.length) await db.localBackupSnapshots.bulkDelete(stale.map((snapshot) => snapshot.id));
}
