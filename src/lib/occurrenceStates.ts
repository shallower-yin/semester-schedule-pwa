import { db } from "../db";
import type { EventOccurrenceState } from "../types";

function occurrenceKey(state: EventOccurrenceState): string {
  return `${state.user_id}:${state.event_id}:${state.occurrence_date}`;
}

function compareNewest(left: EventOccurrenceState, right: EventOccurrenceState): number {
  return (
    right.updated_at.localeCompare(left.updated_at)
    || Number(right.version ?? 0) - Number(left.version ?? 0)
    || right.id.localeCompare(left.id)
  );
}

export function newestOccurrenceState(states: EventOccurrenceState[]): EventOccurrenceState {
  if (!states.length) throw new Error("至少需要一条事项状态记录");
  return [...states].sort(compareNewest)[0];
}

export async function deduplicateLocalOccurrenceStates(userId: string): Promise<number> {
  const states = await db.eventOccurrenceStates
    .filter((state) => state.user_id === userId)
    .toArray();
  const groups = new Map<string, EventOccurrenceState[]>();
  for (const state of states) {
    const key = occurrenceKey(state);
    const group = groups.get(key) ?? [];
    group.push(state);
    groups.set(key, group);
  }

  let removed = 0;
  await db.transaction("rw", db.eventOccurrenceStates, db.syncQueue, async () => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keeper = newestOccurrenceState(group);
      for (const duplicate of group) {
        if (duplicate.id === keeper.id) continue;
        await db.eventOccurrenceStates.delete(duplicate.id);
        const queued = await db.syncQueue
          .where("table_name")
          .equals("eventOccurrenceStates")
          .and((item) => item.record_id === duplicate.id)
          .toArray();
        await db.syncQueue.bulkDelete(queued.map((item) => item.id));
        removed += 1;
      }
    }
  });
  return removed;
}
