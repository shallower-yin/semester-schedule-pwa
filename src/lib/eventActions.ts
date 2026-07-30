import { db, putRecordAndQueue } from "../db";
import type { EventItem, EventOccurrenceState } from "../types";
import { addDays, differenceInCalendarDays, parseLocalDate, toISODate } from "./date";
import { buildEventCompletionRecord, eventCompletionForDate } from "./eventCompletion";
import { syncFields } from "./identity";
import { resetSentRemindersForChangedEvent } from "./notifications";

export async function setEventCompletedForDate(
  eventItem: EventItem,
  occurrenceStates: EventOccurrenceState[],
  date: Date,
  completed: boolean
): Promise<void> {
  const completion = eventCompletionForDate(eventItem, occurrenceStates, date);
  if (!completion.occurs) return;
  const record = buildEventCompletionRecord(eventItem, completion.occurrenceDate, completed, completion.state);
  await putRecordAndQueue("eventOccurrenceStates", record);
}

export async function postponeEventToDate(eventItem: EventItem, targetDate: string): Promise<EventItem> {
  const days = differenceInCalendarDays(parseLocalDate(targetDate), parseLocalDate(eventItem.start_date));
  const next: EventItem = {
    ...eventItem,
    ...syncFields(eventItem),
    start_date: targetDate,
    end_date: toISODate(addDays(parseLocalDate(eventItem.end_date), days)),
    recurrence_until: eventItem.recurrence_until ? toISODate(addDays(parseLocalDate(eventItem.recurrence_until), days)) : null
  };
  await putRecordAndQueue("events", next);
  await resetSentRemindersForChangedEvent(eventItem, next);
  return next;
}
