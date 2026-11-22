import { db, putRecordAndQueue } from "../db";
import type { DeepSeekAssistantAction } from "./deepSeekAssistant";
import {
  applyAnniversaryUpdate,
  applyEventUpdate,
  inferAnniversaryUpdateAction,
  matchAnniversariesByAction,
  matchEventsByTitle,
  memoFromAiAction,
  eventItemFromAiAction,
  recordsFromAiActions,
  type AiCreatedRecord,
  type AiActionResults,
  type AiUpdatedAnniversaryRecord,
  type AiUnmatchedAction,
  type AiUpdatedRecord
} from "./aiEventActions";
import { hardDeleteEventsCascade } from "./hardDelete";
import { refreshNativeReminderSchedule, resetSentRemindersForChangedEvent } from "./notifications";
import { anniversarySourceDateLabel, nextAnniversaryOccurrence } from "./anniversaries";
import { toISODate } from "./date";
import type { EventItem, MemoFolder, SyncTableName } from "../types";
import { syncFields } from "./identity";
import { getMemoChecklistStats } from "./memoFormatting";

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
  ownerId: string,
  signal?: AbortSignal
): Promise<AiActionResults> {
  signal?.throwIfAborted();
  if (actions.some((action) => (action.type === "create_event" || action.type === "create_memo") && action.sourceKey)) {
    return applyAttachmentImport(actions, sourceText, ownerId, signal);
  }
  const inferredAnniversaryUpdate = actions.some((action) => action.type === "update_anniversary")
    ? null
    : inferAnniversaryUpdateAction(sourceText);
  const effectiveActions = inferredAnniversaryUpdate ? [...actions, inferredAnniversaryUpdate] : actions;
  const createActions = effectiveActions.filter((action) =>
    action.type === "create_event" || action.type === "create_anniversary"
  );
  const memoActions = effectiveActions.filter((action) => action.type === "create_memo");
  const folderActions = effectiveActions.filter((action) => action.type === "create_memo_folder");
  if (memoActions.some((action) => action.folderId || action.folderName) || folderActions.length) {
    const ownedFolders = await db.memoFolders.filter((folder) => folder.user_id === ownerId && !folder.deleted_at).toArray();
    signal?.throwIfAborted();
    for (const action of memoActions) {
      if (action.folderId) {
        const folder = ownedFolders.find((item) => item.id === action.folderId);
        if (!folder || (action.folderName && normalizeFolderName(folder.name) !== normalizeFolderName(action.folderName))) {
          throw new Error("未找到指定文件夹，或文件夹不属于当前账号。未执行任何操作。");
        }
      } else if (action.folderName && ownedFolders.filter((folder) => normalizeFolderName(folder.name) === normalizeFolderName(action.folderName!)).length > 1) {
        throw new Error(`存在多个“${action.folderName}”文件夹，请指定要使用的文件夹。未执行任何操作。`);
      }
    }
  }
  const updateActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "update_event" }> => action.type === "update_event"
  );
  const updateAnniversaryActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "update_anniversary" }> => action.type === "update_anniversary"
  );
  const deleteActions = effectiveActions.filter(
    (action): action is Extract<DeepSeekAssistantAction, { type: "delete_event" }> => action.type === "delete_event"
  );
  const pendingCreates = recordsFromAiActions(createActions, sourceText, ownerId);
  const created: AiCreatedRecord[] = [];
  const updated: Array<AiUpdatedRecord | AiUpdatedAnniversaryRecord> = [];
  const deleted: EventItem[] = [];
  const unmatched: AiUnmatchedAction[] = [];
  const folders = new Map<string, MemoFolder>();
  const failures: string[] = [];
  try {
    if (updateActions.length || deleteActions.length) {
      const existing = await db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
      signal?.throwIfAborted();
      for (const action of updateActions) {
        const matches = matchEventsByTitle(existing, action.title, action.date ?? null);
        if (!matches.length) unmatched.push({ action: "update", title: action.title });
        for (const original of matches) {
          if (deleted.some((item) => item.id === original.id)) continue;
          const next = applyEventUpdate(original, action, sourceText);
          await commitAction(["events", "eventOccurrenceStates"], signal, async () => {
            await putRecordAndQueue("events", next);
            signal?.throwIfAborted();
            await resetSentRemindersForChangedEvent(original, next);
          });
          updated.push({ original, updated: next });
        }
      }
      const deleteIds: string[] = [];
      const pendingDeletes: EventItem[] = [];
      for (const action of deleteActions) {
        const matches = matchEventsByTitle(existing, action.title, action.date ?? null);
        if (!matches.length) unmatched.push({ action: "delete", title: action.title });
        for (const matched of matches) {
          if (deleted.some((item) => item.id === matched.id) || deleteIds.includes(matched.id)) continue;
          deleteIds.push(matched.id);
          pendingDeletes.push(matched);
        }
      }
      if (deleteIds.length) {
        await commitAction(["events", "eventOccurrenceStates", "focusSessions"], signal, () => hardDeleteEventsCascade(deleteIds));
        deleted.push(...pendingDeletes);
      }
      signal?.throwIfAborted();
      if (updated.length || deleted.length) await refreshNativeReminderSchedule(ownerId);
      signal?.throwIfAborted();
    }
    if (updateAnniversaryActions.length) {
      const existing = await db.anniversaries.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray();
      signal?.throwIfAborted();
      let updatedAnniversaryCount = 0;
      for (const action of updateAnniversaryActions) {
        const matches = matchAnniversariesByAction(existing, action);
        if (!matches.length) unmatched.push({ action: "update", title: action.title ?? action.scope ?? "纪念日" });
        for (const original of matches) {
          if (updated.some((item) => !("event_type" in item.original) && item.original.id === original.id)) continue;
          const next = applyAnniversaryUpdate(original, action, sourceText);
          await commitAction(["anniversaries"], signal, () => putRecordAndQueue("anniversaries", next));
          updated.push({ original, updated: next });
          updatedAnniversaryCount += 1;
        }
      }
      if (updatedAnniversaryCount) await refreshNativeReminderSchedule(ownerId);
      signal?.throwIfAborted();
    }
    for (const item of pendingCreates) {
      await commitAction([item.table], signal, () => putRecordAndQueue(item.table, item.record));
      created.push(item);
    }
    for (const action of folderActions) {
      let result!: Awaited<ReturnType<typeof getOrCreateMemoFolder>>;
      await commitAction(["memoFolders"], signal, async () => { result = await getOrCreateMemoFolder(action.name, ownerId); });
      folders.set(result.folder.id, result.folder);
      if (result.created) created.push({ table: "memoFolders", record: result.folder });
    }
    for (const action of memoActions) {
      const memo = memoFromAiAction(action, sourceText, ownerId);
      if (!memo) throw new Error("备忘录缺少标题，无法创建。");
      let newFolder: MemoFolder | undefined;
      let resolvedFolder: MemoFolder | undefined;
      await commitAction(["memoFolders", "memos"], signal, async () => {
        let folder: MemoFolder | undefined;
        if (action.folderId) {
          const candidate = await db.memoFolders.get(action.folderId);
          if (!candidate || candidate.user_id !== ownerId || candidate.deleted_at) throw new Error("指定文件夹已不可用，备忘录未保存。");
          folder = candidate;
        } else if (action.folderName?.trim()) {
          const result = await getOrCreateMemoFolder(action.folderName, ownerId);
          folder = result.folder;
          if (result.created) newFolder = folder;
        }
        if (folder) {
          memo.folder_id = folder.id;
          resolvedFolder = folder;
        }
        await putRecordAndQueue("memos", memo);
      });
      if (resolvedFolder) folders.set(resolvedFolder.id, resolvedFolder);
      if (newFolder) created.push({ table: "memoFolders", record: newFolder });
      created.push({ table: "memos", record: memo });
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!created.length && !updated.length && !deleted.length) throw error;
    failures.push(`部分操作未完成，后续操作已停止：${error instanceof Error ? error.message : "保存失败，请重试未完成的部分。"}`);
  }
  return { created, updated, deleted, unmatched, folders: [...folders.values()], failures };
}

function normalizeFolderName(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase();
}

async function applyAttachmentImport(actions: DeepSeekAssistantAction[], sourceText: string, ownerId: string, signal?: AbortSignal): Promise<AiActionResults> {
  const prepared = await Promise.all(actions.map(async (action) => {
    if (action.type === "create_memo_folder") return { action, id: "" };
    if ((action.type !== "create_event" && action.type !== "create_memo") || !action.sourceKey) throw new Error("附件任务不完整，未保存任何记录，请重试。");
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ownerId}:${action.type}:${action.sourceKey}`)));
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return { action, id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` };
  }));
  const created: AiCreatedRecord[] = [];
  const reused: AiCreatedRecord[] = [];
  const folders = new Map<string, MemoFolder>();
  await commitAction(["events", "memos", "memoFolders"], signal, async () => {
    for (const { action, id } of prepared) {
      signal?.throwIfAborted();
      if (action.type === "create_memo_folder") {
        const result = await getOrCreateMemoFolder(action.name, ownerId);
        folders.set(result.folder.id, result.folder);
        if (result.created) created.push({ table: "memoFolders", record: result.folder });
      } else if (action.type === "create_event") {
        const existing = await db.events.get(id);
        if (existing) {
          if (existing.user_id !== ownerId || existing.deleted_at) throw new Error("已导入的事项状态已变化，请核对后重试。");
          reused.push({ table: "events", record: existing });
          continue;
        }
        const record = eventItemFromAiAction(action, sourceText, ownerId, new Date());
        if (!record) throw new Error("附件中有事项日期无效，未保存任何记录。");
        record.id = id;
        await putRecordAndQueue("events", record);
        created.push({ table: "events", record });
      } else if (action.type === "create_memo") {
        const existing = await db.memos.get(id);
        if (existing) {
          if (existing.user_id !== ownerId || existing.deleted_at) throw new Error("已导入的备忘录状态已变化，请核对后重试。");
          reused.push({ table: "memos", record: existing });
          continue;
        }
        const record = memoFromAiAction(action, sourceText, ownerId);
        if (!record) throw new Error("备忘录标题无效，未保存任何记录。");
        if (action.folderId) {
          const folder = await db.memoFolders.get(action.folderId);
          if (!folder || folder.user_id !== ownerId || folder.deleted_at) throw new Error("指定文件夹不可用，未保存任何记录。");
          record.folder_id = folder.id;
          folders.set(folder.id, folder);
        } else if (action.folderName) {
          const result = await getOrCreateMemoFolder(action.folderName, ownerId);
          record.folder_id = result.folder.id;
          folders.set(result.folder.id, result.folder);
          if (result.created) created.push({ table: "memoFolders", record: result.folder });
        }
        record.id = id;
        await putRecordAndQueue("memos", record);
        created.push({ table: "memos", record });
      }
    }
  });
  return { created, reused, updated: [], deleted: [], unmatched: [], folders: [...folders.values()] };
}

async function getOrCreateMemoFolder(name: string, ownerId: string): Promise<{ folder: MemoFolder; created: boolean }> {
  const normalized = normalizeFolderName(name);
  if (!normalized) throw new Error("文件夹名称不能为空。");
  const owned = await db.memoFolders.filter((folder) => folder.user_id === ownerId && !folder.deleted_at).toArray();
  const matches = owned.filter((folder) => normalizeFolderName(folder.name) === normalized);
  if (matches.length > 1) throw new Error(`存在多个“${name}”文件夹，请指定文件夹。`);
  if (matches.length) return { folder: matches[0], created: false };
  const folder: MemoFolder = { ...syncFields(undefined, ownerId), name: name.trim(), sort_order: owned.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1 };
  await putRecordAndQueue("memoFolders", folder);
  return { folder, created: true };
}

// Cancel only the action that has not committed yet. Earlier completed actions
// remain intact; the next transaction also rechecks after acquiring its locks.
async function commitAction(tables: SyncTableName[], signal: AbortSignal | undefined, write: () => Promise<unknown>): Promise<void> {
  signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    await db.transaction("rw", [...tables.map((table) => db.table(table)), db.syncQueue], async (transaction) => {
      signal?.throwIfAborted();
      abort = () => transaction.abort();
      signal?.addEventListener("abort", abort, { once: true });
      await write();
      signal?.throwIfAborted();
    });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
}

export function actionResultsSummary(results: AiActionResults): string {
  const labels = {
    events: "事项",
    anniversaries: "日子",
    memoFolders: "文件夹",
    memos: "备忘录"
  } as const;
  const lines: string[] = [];
  for (const [table, label] of Object.entries(labels)) {
    const titles = results.created
      .filter((item) => item.table === table)
      .map((item) => {
        if (item.table === "memoFolders") return item.record.name;
        if (item.table === "anniversaries") return anniversaryResultLabel(item.record);
        if (item.table === "events") return `${item.record.title}（${item.record.start_date}${item.record.end_date !== item.record.start_date ? ` 至 ${item.record.end_date}` : ""}，${item.record.all_day ? "全天" : `${item.record.start_time}-${item.record.end_time}`}，${item.record.reminder_enabled ? "已启用提醒" : "不提醒"}）`;
        const folder = results.folders?.find((folder) => folder.id === item.record.folder_id);
        const stats = getMemoChecklistStats(item.record.content);
        const details = [folder?.name && `文件夹：${folder.name}`, stats.total && `${stats.total} 条可勾选待办`].filter(Boolean);
        return `${item.record.title}${details.length ? `（${details.join("，")}）` : ""}`;
      });
    if (!titles.length) continue;
    lines.push("已创建" + label + "：" + mergedTitles(titles));
  }
  const reusedFolders = results.folders?.filter((folder) => !results.created.some((item) =>
    (item.table === "memoFolders" && item.record.id === folder.id) || (item.table === "memos" && item.record.folder_id === folder.id)
  ));
  if (reusedFolders?.length) lines.push("已使用文件夹：" + reusedFolders.map((folder) => folder.name).join("、"));
  const updatedEventTitles = results.updated.filter((item): item is AiUpdatedRecord => "event_type" in item.updated).map((item) => item.updated.title);
  const updatedAnniversaryTitles = results.updated.filter((item): item is AiUpdatedAnniversaryRecord => !("event_type" in item.updated)).map((item) => anniversaryResultLabel(item.updated));
  if (updatedEventTitles.length) lines.push("已修改事项：" + mergedTitles(updatedEventTitles));
  if (updatedAnniversaryTitles.length) lines.push("已修改日子：" + mergedTitles(updatedAnniversaryTitles));
  const deletedTitles = results.deleted.map((item) => item.title);
  if (deletedTitles.length) lines.push("已删除事项：" + mergedTitles(deletedTitles));
  const missingUpdates = results.unmatched.filter((item) => item.action === "update").map((item) => item.title);
  if (missingUpdates.length) lines.push("未找到要修改的事项：" + mergedTitles(missingUpdates));
  const missingDeletes = results.unmatched.filter((item) => item.action === "delete").map((item) => item.title);
  if (missingDeletes.length) lines.push("未找到要删除的事项：" + mergedTitles(missingDeletes));
  if (results.failures?.length) lines.push(...results.failures);
  if (results.reused?.length) {
    const events = results.reused.filter((item) => item.table === "events").length;
    const memos = results.reused.filter((item) => item.table === "memos").length;
    lines.push(`已保留${[events && `${events} 条已导入事项`, memos && `${memos} 份已导入备忘录`].filter(Boolean).join("、")}，未重复创建。`);
  }
  return lines.join("\n");
}

export function assistantReplyAfterActions(answer: string, results: AiActionResults, requestedActions: number, question: string): string {
  const summary = actionResultsSummary(results);
  if (summary) return summary;
  if (requestedActions || (/(创建|新建|添加|录入|记录到|加入日程|修改|删除)/.test(question)
    && /(?:已(?:经)?|成功).{0,30}(?:创建|新增|添加|保存|修改|更新|删除|归档|记录)|(?:创建|新增|添加|保存|修改|更新|删除).{0,10}成功/.test(answer))) {
    return "未执行任何操作，请补充或核对要处理的内容。";
  }
  return answer;
}

function anniversaryResultLabel(record: AiUpdatedAnniversaryRecord["updated"]): string {
  const date = anniversarySourceDateLabel(record);
  const next = toISODate(nextAnniversaryOccurrence(record));
  return `${record.title}（${record.calendar_type === "lunar" ? date : `公历 ${date}`}，下次 ${next}）`;
}

function mergedTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1);
  return [...counts.entries()]
    .map(([title, count]) => (count > 1 ? `${title}（${count} 个）` : title))
    .join("、");
}
