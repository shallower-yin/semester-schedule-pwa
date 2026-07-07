import { db } from "../db";
import type { BackupFile, SyncTableName } from "../types";
import { markBackupExported } from "./backupStatus";

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
  "focusSessions"
];

export const OPTIONAL_TABLES_IN_OLD_BACKUPS = new Set<SyncTableName>(["anniversaries"]);

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

export function downloadBackup(backup: BackupFile, fileName: string): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  markBackupExported();
}
