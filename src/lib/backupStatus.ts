const LAST_BACKUP_KEY = "semester-schedule-last-backup-at";
const BACKUP_INTERVAL_DAYS = 7;

export function markBackupExported(date = new Date()): void {
  localStorage.setItem(LAST_BACKUP_KEY, date.toISOString());
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
