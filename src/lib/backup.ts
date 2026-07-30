import { db } from "../db";
import type { BackupFile, SyncTableName } from "../types";
import { markBackupExported } from "./backupStatus";
import { exportText, type ExportedFile } from "./fileExport";

export const BACKUP_TABLES: SyncTableName[] = [
  "semesters",
  "classPeriods",
  "courses",
  "courseSchedules",
  "courseCancellations",
  "categories",
  "events",
  "eventOccurrenceStates",
  "anniversaries",
  "memoFolders",
  "memos",
  "focusSettings",
  "focusSessions",
  "restSessions",
  "healthProfiles",
  "healthLogs"
];

export const OPTIONAL_TABLES_IN_OLD_BACKUPS = new Set<SyncTableName>(["anniversaries", "restSessions", "healthProfiles", "healthLogs"]);

export function prepareBackupRecordsForRestore(
  incomingRecords: Array<Record<string, unknown>>,
  existingRecords: Array<Record<string, unknown> | undefined>,
  currentUserId: string,
  now = new Date()
): Array<Record<string, unknown>> {
  const restorableIndexes = incomingRecords
    .map((record, index) => ({ record, index }))
    .filter(({ record }) =>
      record.user_id === currentUserId
      || (record.user_id === "local" && currentUserId !== "local")
    );
  if (!restorableIndexes.length) return incomingRecords;

  const newestKnownTimestamp = restorableIndexes.reduce((latest, { record, index }) => {
    const existing = existingRecords[index];
    return Math.max(
      latest,
      timestampValue(record.updated_at),
      timestampValue(existing?.updated_at)
    );
  }, now.getTime());
  // Keep one timestamp for the whole restore and make it strictly newer than the
  // local/cloud version that was present immediately before import.
  const restoredAt = new Date(newestKnownTimestamp + 1).toISOString();

  return incomingRecords.map((record, index) => {
    const shouldRestore = record.user_id === currentUserId
      || (record.user_id === "local" && currentUserId !== "local");
    if (!shouldRestore) return record;
    const existing = existingRecords[index];
    return {
      ...record,
      user_id: currentUserId,
      version: Math.max(Number(record.version ?? 0), Number(existing?.version ?? 0)) + 1,
      updated_at: restoredAt
    };
  });
}

function timestampValue(value: unknown): number {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function createBackup(): Promise<BackupFile> {
  const data = {} as BackupFile["data"];
  for (const name of BACKUP_TABLES) {
    data[name] = await db.table(name).toArray();
  }
  return {
    format: "semester-schedule-backup",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    data
  };
}

export async function downloadBackup(backup: BackupFile, fileName: string): Promise<ExportedFile> {
  const result = await exportText(JSON.stringify(backup, null, 2), fileName, "application/json;charset=utf-8");
  if (result.saved) markBackupExported();
  return result;
}
