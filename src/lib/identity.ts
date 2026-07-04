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

export function syncFields(existing?: { id: string; created_at: string; version: number }) {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: getCurrentUserId(),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    version: (existing?.version ?? 0) + 1,
    device_id: getDeviceId()
  };
}
