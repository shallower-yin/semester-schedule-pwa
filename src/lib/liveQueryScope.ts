export interface ScopedLiveQueryValue<T> {
  scope: string;
  value: T;
}

/** Tag a Dexie live-query result with the account/dependency generation that produced it. */
export function scopedLiveQueryValue<T>(scope: string, value: T): ScopedLiveQueryValue<T> {
  return { scope, value };
}

/**
 * Dexie intentionally retains the previous subscription value while a changed
 * dependency resubscribes. Never expose that retained value to another owner
 * or to a query whose course/semester dependencies have changed.
 */
export function currentLiveQueryValue<T>(
  result: ScopedLiveQueryValue<T> | undefined,
  currentScope: string
): T | undefined {
  return result?.scope === currentScope ? result.value : undefined;
}

/** Keep a draft record visible only while it still belongs to the active account. */
export function currentOwnerRecord<T extends { user_id: string }>(
  record: T | null | undefined,
  ownerId: string
): T | null | undefined {
  if (record == null) return record;
  return record.user_id === ownerId ? record : undefined;
}
