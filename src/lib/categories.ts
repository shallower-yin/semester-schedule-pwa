import { db, queueChange } from "../db";
import { hardDeleteLocalRecord } from "./hardDelete";
import { syncFields } from "./identity";
import type { Category } from "../types";

function categoryKey(category: Category): string {
  return category.name.trim().toLocaleLowerCase("zh-CN");
}

export function uniqueCategoriesByName(categories: Category[]): Category[] {
  const unique = new Map<string, Category>();
  for (const category of categories) {
    const key = categoryKey(category);
    if (!unique.has(key)) unique.set(key, category);
  }
  return [...unique.values()];
}

export async function deduplicateCategories(userId: string): Promise<number> {
  const active = await db.categories
    .filter((category) => category.user_id === userId && !category.deleted_at)
    .sortBy("created_at");
  const groups = new Map<string, Category[]>();
  for (const category of active) {
    const key = categoryKey(category);
    const group = groups.get(key) ?? [];
    group.push(category);
    groups.set(key, group);
  }

  let removed = 0;
  await db.transaction("rw", db.categories, db.events, db.syncQueue, async () => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [keeper, ...duplicates] = group.sort(
        (left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
      );
      for (const duplicate of duplicates) {
        const linkedEvents = await db.events
          .filter(
            (event) =>
              event.user_id === userId &&
              event.category_id === duplicate.id &&
              !event.deleted_at
          )
          .toArray();
        for (const event of linkedEvents) {
          const updated = {
            ...event,
            ...syncFields(event),
            user_id: userId,
            category_id: keeper.id
          };
          await db.events.put(updated);
          await queueChange("events", updated.id);
        }
        await hardDeleteLocalRecord("categories", duplicate.id);
        removed += 1;
      }
    }
  });
  return removed;
}
