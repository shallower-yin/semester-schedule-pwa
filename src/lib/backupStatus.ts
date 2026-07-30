import { getCurrentUserId } from "./identity";

const LAST_BACKUP_KEY = "semester-schedule-last-backup-at";
const BACKUP_INTERVAL_DAYS = 7;
export const BACKUP_STATUS_CHANGED_EVENT = "semester-schedule-backup-status-changed";

export function markBackupCompleted(date = new Date(), ownerId = getCurrentUserId()): void {
  localStorage.setItem(ownerBackupKey(ownerId), date.toISOString());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BACKUP_STATUS_CHANGED_EVENT));
  }
}

export function markBackupExported(date = new Date(), ownerId = getCurrentUserId()): void {
  markBackupCompleted(date, ownerId);
}

export function getLastBackupAt(ownerId = getCurrentUserId()): string | null {
  return localStorage.getItem(ownerBackupKey(ownerId));
}

export function backupIsDue(now = new Date(), ownerId = getCurrentUserId()): boolean {
  const value = getLastBackupAt(ownerId);
  if (!value) return true;
  const last = new Date(value);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= BACKUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

function ownerBackupKey(ownerId: string): string {
  return `${LAST_BACKUP_KEY}:${ownerId}`;
}
