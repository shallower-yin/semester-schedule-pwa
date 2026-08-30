const DEVICE_KEY = "semester-schedule-device-id";
const USER_KEY = "semester-schedule-current-user-id";

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

export function setCurrentUserId(userId: string | null): void {
  if (userId) localStorage.setItem(USER_KEY, userId);
  else localStorage.removeItem(USER_KEY);
}

export function getCurrentUserId(): string {
  return localStorage.getItem(USER_KEY) ?? "local";
}

interface ExistingSyncRecord {
  id: string;
  created_at: string;
  version: number;
  user_id: string;
}

export function syncFields(existing: ExistingSyncRecord, ownerId?: string): ReturnType<typeof buildSyncFields>;
export function syncFields(existing: ExistingSyncRecord | undefined, ownerId: string): ReturnType<typeof buildSyncFields>;
export function syncFields(existing?: ExistingSyncRecord, ownerId?: string) {
  if (existing?.user_id && ownerId && existing.user_id !== ownerId) {
    throw new Error("更新同步记录时 ownerId 必须与已有记录一致。");
  }
  const resolvedOwnerId = existing?.user_id ?? ownerId;
  if (!resolvedOwnerId?.trim()) throw new Error("新建同步记录时必须显式指定 ownerId。");
  return buildSyncFields(existing, resolvedOwnerId);
}

function buildSyncFields(existing: ExistingSyncRecord | undefined, ownerId: string) {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: ownerId,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    version: (existing?.version ?? 0) + 1,
    device_id: getDeviceId()
  };
}
