import { db, putRecordAndQueue } from "../db";
import type { EventOccurrenceState } from "../types";
import { eventOccursOn, parseLocalDate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { setEventCompletedForDate } from "./eventActions";
import {
  ScheduleWidget,
  type ScheduleWidgetCompletionAction,
  type ScheduleWidgetPlugin
} from "./scheduleWidgetPlugin";
import { syncFields } from "./identity";

type CompletionBridge = Pick<ScheduleWidgetPlugin, "getPendingCompletionActions" | "ackCompletionActions">;

export interface WidgetCompletionConsumptionResult {
  received: number;
  applied: number;
  acknowledged: number;
}

const activeRuns = new Map<string, Promise<WidgetCompletionConsumptionResult>>();

/**
 * Consume the native outbox once. Calls for the same account are serialized so
 * simultaneous pageshow/live-query effects cannot increment a record twice.
 */
export function consumePendingWidgetCompletionActions(
  ownerId: string,
  bridge: CompletionBridge = ScheduleWidget
): Promise<WidgetCompletionConsumptionResult> {
  const owner = ownerId.trim();
  if (!owner) return Promise.resolve(emptyResult());
  const previous = activeRuns.get(owner) ?? Promise.resolve(emptyResult());
  const run = previous
    .catch(() => emptyResult())
    .then(() => consumeOnce(owner, bridge));
  activeRuns.set(owner, run);
  void run.finally(() => {
    if (activeRuns.get(owner) === run) activeRuns.delete(owner);
  }).catch(() => undefined);
  return run;
}

async function consumeOnce(ownerId: string, bridge: CompletionBridge): Promise<WidgetCompletionConsumptionResult> {
  const result = await bridge.getPendingCompletionActions({ ownerId });
  if (!result?.accepted || !Array.isArray(result.actions) || result.actions.length === 0) return emptyResult();

  let applied = 0;
  const acknowledged: string[] = [];
  for (const rawAction of result.actions) {
    const action = normalizeAction(rawAction);
    if (!action) {
      if (isActionId(rawAction?.actionId)) acknowledged.push(rawAction.actionId);
      continue;
    }
    try {
      const changed = await applyCompletionAction(ownerId, action);
      if (changed) applied += 1;
      acknowledged.push(action.actionId);
    } catch {
      // Leave just this action pending. A later foreground pass can retry it;
      // successfully applied actions remain safe because completion is idempotent.
    }
  }

  let acknowledgedCount = 0;
  if (acknowledged.length) {
    const ack = await bridge.ackCompletionActions({ ownerId, actionIds: acknowledged });
    if (ack?.accepted) acknowledgedCount = Math.max(0, Math.min(acknowledged.length, ack.acknowledged));
  }
  return { received: result.actions.length, applied, acknowledged: acknowledgedCount };
}

async function applyCompletionAction(ownerId: string, action: ScheduleWidgetCompletionAction): Promise<boolean> {
  if (action.kind === "todo") {
    const todo = await db.todos.get(action.targetId);
    if (!todo || todo.user_id !== ownerId || todo.deleted_at || todo.completed_at) return false;
    // The native outbox is retryable. A newer incomplete record means the user
    // explicitly changed or restored it after this tap, so the stale action
    // must be acknowledged without overwriting that newer choice.
    if (updatedAfterAction(todo.updated_at, action.createdAt)) return false;
    const completedAt = safeCompletionTime(action.createdAt);
    await putRecordAndQueue("todos", {
      ...todo,
      ...syncFields(todo),
      completed_at: completedAt
    });
    return true;
  }

  const eventItem = await db.events.get(action.targetId);
  if (!eventItem || eventItem.user_id !== ownerId || eventItem.deleted_at || !action.occurrenceDate) return false;
  const occurrenceDate = parseLocalDate(action.occurrenceDate);
  if (!eventOccursOn(eventItem, occurrenceDate)) return false;
  const occurrenceStates = await db.eventOccurrenceStates
    .where("[event_id+occurrence_date]")
    .equals([eventItem.id, action.occurrenceDate])
    .filter((item) => item.user_id === ownerId)
    .toArray() as EventOccurrenceState[];
  if (eventCompletionForDate(eventItem, occurrenceStates, occurrenceDate).completed) return false;
  if (occurrenceStates.some((item) => (
    !item.deleted_at
    && !item.completed
    && updatedAfterAction(item.updated_at, action.createdAt)
  ))) return false;
  await setEventCompletedForDate(eventItem, occurrenceStates, occurrenceDate, true);
  return true;
}

function normalizeAction(value: ScheduleWidgetCompletionAction | undefined): ScheduleWidgetCompletionAction | null {
  if (!value || !isActionId(value.actionId) || !isTargetId(value.targetId)) return null;
  if (value.kind !== "todo" && value.kind !== "event") return null;
  if (!Number.isFinite(Date.parse(value.createdAt))) return null;
  if (value.kind === "event" && !isISODate(value.occurrenceDate)) return null;
  if (value.kind === "todo" && value.occurrenceDate) return null;
  return {
    actionId: value.actionId.toLowerCase(),
    kind: value.kind,
    targetId: value.targetId,
    ...(value.kind === "event" ? { occurrenceDate: value.occurrenceDate } : {}),
    createdAt: new Date(value.createdAt).toISOString()
  };
}

function safeCompletionTime(value: string): string {
  const timestamp = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) return new Date(now).toISOString();
  return new Date(timestamp).toISOString();
}

function updatedAfterAction(updatedAt: string, actionCreatedAt: string): boolean {
  const updatedTimestamp = Date.parse(updatedAt);
  const actionTimestamp = Date.parse(actionCreatedAt);
  return Number.isFinite(updatedTimestamp)
    && Number.isFinite(actionTimestamp)
    && updatedTimestamp > actionTimestamp;
}

function isActionId(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{64}$/i.test(value);
}

function isTargetId(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseLocalDate(value);
  return !Number.isNaN(parsed.getTime()) && [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-") === value;
}

function emptyResult(): WidgetCompletionConsumptionResult {
  return { received: 0, applied: 0, acknowledged: 0 };
}
