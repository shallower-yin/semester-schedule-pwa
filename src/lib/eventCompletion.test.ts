import { beforeEach, describe, expect, it } from "vitest";
import { setCurrentUserId, syncFields } from "./identity";
import { buildEventCompletionRecord, eventCompletionForDate } from "./eventCompletion";
import type { EventItem, EventOccurrenceState } from "../types";

describe("事项完成状态", () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentUserId("local");
  });

  it("读取指定日期的完成状态，并在更新时保留提醒发送记录", () => {
    const eventItem = eventRecord({
      id: "event-1",
      start_date: "2026-07-07",
      end_date: "2026-07-07"
    });
    const existing: EventOccurrenceState = {
      ...syncFields(),
      id: "state-1",
      event_id: eventItem.id,
      occurrence_date: "2026-07-07",
      completed: false,
      reminder_sent_at: "2026-07-07T00:50:00.000Z"
    };

    const completion = eventCompletionForDate(eventItem, [existing], new Date(2026, 6, 7));
    const record = buildEventCompletionRecord(eventItem, completion.occurrenceDate, true, completion.state);

    expect(completion).toMatchObject({
      occurrenceDate: "2026-07-07",
      occurs: true,
      completed: false
    });
    expect(record).toMatchObject({
      id: "state-1",
      event_id: "event-1",
      occurrence_date: "2026-07-07",
      completed: true,
      reminder_sent_at: "2026-07-07T00:50:00.000Z"
    });
  });
});

function eventRecord(overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...syncFields(),
    id: "event-1",
    event_type: "event",
    title: "测试事项",
    start_date: "2026-07-07",
    start_time: "09:00",
    end_date: "2026-07-07",
    end_time: "10:00",
    all_day: false,
    category_id: null,
    color: "#e36b32",
    note: "",
    recurrence_type: "none",
    recurrence_until: null,
    reminder_enabled: false,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    ...overrides
  };
}
