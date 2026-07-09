import { db } from "../db";
import type { BackupFile, LocalBackupSnapshot } from "../types";
import { BACKUP_TABLES, createBackup } from "./backup";
import { backupIsDue, markBackupCompleted } from "./backupStatus";

export const AUTO_BACKUP_KEEP_LIMIT = 3;

let scheduledBackupPromise: Promise<LocalBackupSnapshot | null> | null = null;

export function countBackupRecords(backup: BackupFile): number {
  return BACKUP_TABLES.reduce((sum, tableName) => sum + backup.data[tableName].length, 0);
}

export async function createLocalBackupSnapshot(
  reason: LocalBackupSnapshot["reason"] = "scheduled",
  now = new Date()
): Promise<LocalBackupSnapshot> {
  const backup = await createBackup();
  backup.exported_at = now.toISOString();
  const snapshot: LocalBackupSnapshot = {
    id: crypto.randomUUID(),
    created_at: now.toISOString(),
    reason,
    record_count: countBackupRecords(backup),
    backup
  };

  await db.localBackupSnapshots.put(snapshot);
  await trimLocalBackupSnapshots();
  markBackupCompleted(now);
  return snapshot;
}

export async function ensureScheduledLocalBackup(now = new Date()): Promise<LocalBackupSnapshot | null> {
  if (!backupIsDue(now)) return null;
  if (!scheduledBackupPromise) {
    scheduledBackupPromise = createLocalBackupSnapshot("scheduled", now).finally(() => {
      scheduledBackupPromise = null;
    });
  }
  return scheduledBackupPromise;
}

export async function getLatestLocalBackupSnapshot(): Promise<LocalBackupSnapshot | undefined> {
  return db.localBackupSnapshots.orderBy("created_at").reverse().first();
}

async function trimLocalBackupSnapshots(): Promise<void> {
  const snapshots = await db.localBackupSnapshots.orderBy("created_at").reverse().toArray();
  const stale = snapshots.slice(AUTO_BACKUP_KEEP_LIMIT);
  if (stale.length) await db.localBackupSnapshots.bulkDelete(stale.map((snapshot) => snapshot.id));
}
