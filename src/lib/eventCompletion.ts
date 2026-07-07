import type { EventItem, EventOccurrenceState } from "../types";
import { eventOccursOn, toISODate } from "./date";
import { syncFields } from "./identity";

export interface EventCompletionForDate {
  occurrenceDate: string;
  occurs: boolean;
  completed: boolean;
  state: EventOccurrenceState | undefined;
}

export function eventCompletionForDate(
  eventItem: EventItem,
  occurrenceStates: EventOccurrenceState[],
  date: Date
): EventCompletionForDate {
  const occurrenceDate = toISODate(date);
  const state = occurrenceStates.find(
    (item) => item.event_id === eventItem.id && item.occurrence_date === occurrenceDate && !item.deleted_at
  );
  return {
    occurrenceDate,
    occurs: eventOccursOn(eventItem, date),
    completed: state?.completed ?? false,
    state
  };
}

export function buildEventCompletionRecord(
  eventItem: EventItem,
  occurrenceDate: string,
  completed: boolean,
  existing?: EventOccurrenceState
): EventOccurrenceState {
  return {
    ...syncFields(existing),
    event_id: eventItem.id,
    occurrence_date: occurrenceDate,
    completed,
    reminder_sent_at: existing?.reminder_sent_at ?? null
  };
}
