const LAST_BACKUP_KEY = "semester-schedule-last-backup-at";
const BACKUP_INTERVAL_DAYS = 7;
export const BACKUP_STATUS_CHANGED_EVENT = "semester-schedule-backup-status-changed";

export function markBackupExported(date = new Date()): void {
  localStorage.setItem(LAST_BACKUP_KEY, date.toISOString());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BACKUP_STATUS_CHANGED_EVENT));
  }
}

export function getLastBackupAt(): string | null {
  return localStorage.getItem(LAST_BACKUP_KEY);
}

export function backupIsDue(now = new Date()): boolean {
  const value = getLastBackupAt();
  if (!value) return true;
  const last = new Date(value);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= BACKUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}
