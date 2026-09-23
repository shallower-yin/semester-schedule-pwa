import { db, putRecordAndQueue } from "../db";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";
import {
  applyAnniversaryUpdate,
  applyEventUpdate,
  inferAnniversaryUpdateAction,
  matchAnniversariesByAction,
  matchEventsByTitle,
  recordsFromAiActions,
  type AiActionResults,
  type AiUpdatedAnniversaryRecord,
  type AiUnmatchedAction,
  type AiUpdatedRecord
} from "./aiEventActions";
import { hardDeleteEventsCascade } from "./hardDelete";
import { refreshNativeReminderSchedule, resetSentRemindersForChangedEvent } from "./notifications";
import type { EventItem } from "../types";

/**
 * Apply every AI action to local storage and the sync queue.
 *
 * Creates go through the existing `recordsFromAiActions` converter. Updates
 * match existing events or anniversaries so the assistant can correct records
 * it previously created instead of stacking duplicates.
 */
export async function applyActionsToLocalRecords(
  actions: DeepSeekAssistantAction[],
  sourceText: string,
  ownerId: string
): Promise<AiActionResults> {
  const inferredAnniversaryUpdate = actions.some((action) => action.type === "update_anniversary")
    ? null
    : inferAnniversaryUpdateAction(sourceText);
  const effectiveActions = inferredAnniversaryUpdate ? [...actions, inferredAnniversaryUpdate] : actions;
  const createActions = effectiveActions.filter((action) =>
    action.type === "create_event" || action.type === "create_anniversary" || action.type === "create_memo"
  );
  const updateActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "update_event" }> => action.type === "update_event"
  );
  const updateAnniversaryActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "update_anniversary" }> => action.type === "update_anniversary"
  );
  const deleteActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "delete_event" }> => action.type === "delete_event"
  );
  const created = recordsFromAiActions(createActions, sourceText, ownerId);
  const updated: Array<AiUpdatedRecord | AiUpdatedAnniversaryRecord> = [];
  const deleted: EventItem[] = [];
  const unmatched: AiUnmatchedAction[] = [];
  if (updateActions.length || deleteActions.length) {
    const existing = await db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
    for (const action of updateActions) {
      const matches = matchEventsByTitle(existing, action.title, action.date ?? null);
      if (!matches.length) unmatched.push({ action: "update", title: action.title });
      for (const original of matches) {
        if (deleted.some((item) => item.id === original.id)) continue;
        const next = applyEventUpdate(original, action);
        await putRecordAndQueue("events", next);
        await resetSentRemindersForChangedEvent(original, next);
        updated.push({ original, updated: next });
      }
    }
    const deleteIds: string[] = [];
    for (const action of deleteActions) {
      const matches = matchEventsByTitle(existing, action.title, action.date ?? null);
      if (!matches.length) unmatched.push({ action: "delete", title: action.title });
      for (const matched of matches) {
        if (deleted.some((item) => item.id === matched.id) || deleteIds.includes(matched.id)) continue;
        deleteIds.push(matched.id);
        deleted.push(matched);
      }
    }
    if (deleteIds.length) await hardDeleteEventsCascade(deleteIds);
    if (updated.length || deleted.length) await refreshNativeReminderSchedule(ownerId);
  }
  if (updateAnniversaryActions.length) {
    const existing = await db.anniversaries.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
    let updatedAnniversaryCount = 0;
    for (const action of updateAnniversaryActions) {
      const matches = matchAnniversariesByAction(existing, action);
      if (!matches.length) unmatched.push({ action: "update", title: action.title ?? action.scope ?? "纪念日" });
      for (const original of matches) {
        if (updated.some((item) => !("event_type" in item.original) && item.original.id === original.id)) continue;
        const next = applyAnniversaryUpdate(original, action);
        await putRecordAndQueue("anniversaries", next);
        updated.push({ original, updated: next });
        updatedAnniversaryCount += 1;
      }
    }
    if (updatedAnniversaryCount) await refreshNativeReminderSchedule(ownerId);
  }
  for (const item of created) {
    await putRecordAndQueue(item.table, item.record);
  }
  return { created, updated, deleted, unmatched };
}

export function actionResultsSummary(results: AiActionResults): string {
  const labels = {
    events: "事项",
    anniversaries: "日子",
    memos: "备忘录"
  } as const;
  const lines: string[] = [];
  for (const [table, label] of Object.entries(labels)) {
    const titles = results.created
      .filter((item) => item.table === table)
      .map((item) => item.record.title);
    if (!titles.length) continue;
    lines.push("已创建" + label + "：" + mergedTitles(titles));
  }
  const updatedEventTitles = results.updated.filter((item): item is AiUpdatedRecord => "event_type" in item.updated).map((item) => item.updated.title);
  const updatedAnniversaryTitles = results.updated.filter((item): item is AiUpdatedAnniversaryRecord => !("event_type" in item.updated)).map((item) => item.updated.title);
  if (updatedEventTitles.length) lines.push("已修改事项：" + mergedTitles(updatedEventTitles));
  if (updatedAnniversaryTitles.length) lines.push("已修改日子：" + mergedTitles(updatedAnniversaryTitles));
  const deletedTitles = results.deleted.map((item) => item.title);
  if (deletedTitles.length) lines.push("已删除事项：" + mergedTitles(deletedTitles));
  const missingUpdates = results.unmatched.filter((item) => item.action === "update").map((item) => item.title);
  if (missingUpdates.length) lines.push("未找到要修改的事项：" + mergedTitles(missingUpdates));
  const missingDeletes = results.unmatched.filter((item) => item.action === "delete").map((item) => item.title);
  if (missingDeletes.length) lines.push("未找到要删除的事项：" + mergedTitles(missingDeletes));
  return lines.join("\n");
}

function mergedTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1);
  return [...counts.entries()]
    .map(([title, count]) => (count > 1 ? `${title}（${count} 个）` : title))
    .join("、");
}
