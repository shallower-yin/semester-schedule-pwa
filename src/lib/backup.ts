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
