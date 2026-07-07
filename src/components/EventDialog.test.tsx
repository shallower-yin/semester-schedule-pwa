import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { toISODate } from "../lib/date";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { EventItem } from "../types";
import { EventDialog } from "./EventDialog";

describe("事项编辑弹窗", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.categories.clear();
    await db.events.clear();
    await db.eventOccurrenceStates.clear();
    await db.syncQueue.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("可以在编辑弹窗中快捷标记今天完成", async () => {
    const today = toISODate(new Date());
    const eventItem = eventRecord({ start_date: today, end_date: today });
    await db.events.put(eventItem);

    render(
      <EventDialog
        eventItem={eventItem}
        initialDate={today}
        ownerId="local"
        occurrenceStates={[]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(`今天 ${today} 未完成`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "标记今天完成" }));

    await waitFor(async () => {
      const state = await db.eventOccurrenceStates.where("[event_id+occurrence_date]").equals([eventItem.id, today]).first();
      expect(state?.completed).toBe(true);
    });
    const queued = await db.syncQueue.where("table_name").equals("eventOccurrenceStates").first();
    expect(queued?.record_id).toBeTruthy();
    expect(screen.getByText("已标记今天完成。")).toBeInTheDocument();
  });

  it("新增普通事项时保存开始到结束日期的每日范围", async () => {
    const onClose = vi.fn();
    render(
      <EventDialog
        initialDate="2026-07-25"
        ownerId="local"
        occurrenceStates={[]}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "连续训练" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-07-27" } });
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));

    await waitFor(async () => {
      const saved = await db.events.filter((eventItem) => eventItem.title === "连续训练").first();
      expect(saved).toEqual(expect.objectContaining({
        event_type: "event",
        start_date: "2026-07-25",
        end_date: "2026-07-27"
      }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("新增习惯时保存为 habit 类型", async () => {
    render(
      <EventDialog
        initialDate="2026-07-25"
        initialEventType="habit"
        ownerId="local"
        occurrenceStates={[]}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "喝水" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "保存习惯" }));

    await waitFor(async () => {
      const saved = await db.events.filter((eventItem) => eventItem.title === "喝水").first();
      expect(saved).toEqual(expect.objectContaining({
        event_type: "habit",
        start_date: "2026-07-25",
        end_date: "2026-07-31"
      }));
    });
  });
});

function eventRecord(overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...syncFields(),
    id: "event-1",
    event_type: "event",
    title: "今天事项",
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
    reminder_enabled: true,
    reminder_minutes_before: 10,
    timezone: "Asia/Shanghai",
    ...overrides,
    recurrence_interval: overrides.recurrence_interval ?? 1
  };
}
