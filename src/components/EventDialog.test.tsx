import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { addDays, toISODate } from "../lib/date";
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

  it("标题旁可完成非今天的单日事项，并恢复未完成", async () => {
    const date = toISODate(addDays(new Date(), 3));
    const eventItem = eventRecord({ start_date: date, end_date: date });
    const state = {
      ...syncFields(undefined, "local"),
      event_id: eventItem.id,
      occurrence_date: date,
      completed: false,
      reminder_sent_at: "2026-07-07T00:50:00.000Z"
    };
    await db.events.put(eventItem);
    await db.eventOccurrenceStates.put(state);
    const onClose = vi.fn();
    render(<EventDialog eventItem={eventItem} initialDate={date} ownerId="local" occurrenceStates={[state]} onClose={onClose} />);

    const complete = screen.getByRole("button", { name: "标记完成" });
    expect(complete.closest("header")).toContainElement(screen.getByRole("heading", { name: "编辑事项" }));
    expect(complete).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(complete);

    await waitFor(async () => expect(await db.eventOccurrenceStates.get(state.id)).toMatchObject({
      completed: true,
      occurrence_date: date,
      reminder_sent_at: state.reminder_sent_at
    }));
    const restore = await screen.findByRole("button", { name: "标记未完成" });
    await waitFor(() => expect(restore).not.toBeDisabled());
    expect(restore).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(restore);

    await waitFor(async () => expect((await db.eventOccurrenceStates.get(state.id))?.completed).toBe(false));
    expect((await db.events.get(eventItem.id))?.completed_at).toBeFalsy();
    expect(onClose).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText("地点"), { target: { value: "图书馆二楼" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-07-27" } });
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));

    await waitFor(async () => {
      const saved = await db.events.filter((eventItem) => eventItem.title === "连续训练").first();
      expect(saved).toEqual(expect.objectContaining({
        event_type: "event",
        start_date: "2026-07-25",
        end_date: "2026-07-27",
        location: "图书馆二楼"
      }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("跨标签切换共享身份后，新建事项仍归属打开弹窗的账号", async () => {
    setCurrentUserId("alice");
    render(
      <EventDialog
        initialDate="2026-07-25"
        ownerId="alice"
        occurrenceStates={[]}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Alice 的事项" } });
    setCurrentUserId("bob");
    fireEvent.click(screen.getByRole("button", { name: "保存事项" }));

    await waitFor(async () => {
      const saved = await db.events.filter((item) => item.title === "Alice 的事项").first();
      expect(saved?.user_id).toBe("alice");
    });
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

  it("支持从开始日按间隔天数重复并用持续天数计算截止日期", async () => {
    render(
      <EventDialog
        initialDate="2026-07-25"
        initialEventType="habit"
        ownerId="local"
        occurrenceStates={[]}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "吃药" } });
    fireEvent.change(screen.getByLabelText("重复"), { target: { value: "interval" } });
    fireEvent.change(screen.getByLabelText("间隔天数"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("持续天数"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存习惯" }));

    await waitFor(async () => {
      const saved = await db.events.filter((eventItem) => eventItem.title === "吃药").first();
      expect(saved).toEqual(expect.objectContaining({
        event_type: "habit",
        start_date: "2026-07-25",
        end_date: "2026-07-25",
        recurrence_type: "interval",
        recurrence_interval: 5,
        recurrence_until: "2026-08-23"
      }));
    });
  });

  it("提醒提前时间支持 3、5、7 天", () => {
    const eventItem = eventRecord();
    render(
      <EventDialog
        eventItem={eventItem}
        initialDate={eventItem.start_date}
        ownerId="local"
        occurrenceStates={[]}
        onClose={vi.fn()}
      />
    );

    const reminderSelect = screen.getByLabelText("提前时间");
    expect(reminderSelect).toHaveTextContent("提前 3 天");
    expect(reminderSelect).toHaveTextContent("提前 5 天");
    expect(reminderSelect).toHaveTextContent("提前 7 天");
  });

  it("重复事项可以提前完成整个事项并恢复", async () => {
    const today = toISODate(new Date());
    const eventItem = eventRecord({
      start_date: today,
      end_date: today,
      recurrence_type: "daily",
      recurrence_until: "2026-12-31"
    });
    await db.events.put(eventItem);
    render(<EventDialog eventItem={eventItem} initialDate={today} ownerId="local" occurrenceStates={[]} onClose={vi.fn()} />);

    const complete = screen.getByRole("button", { name: "完成整个事项" });
    expect(complete.closest("header")).toContainElement(screen.getByRole("heading", { name: "编辑事项" }));
    fireEvent.click(complete);
    await waitFor(async () => expect((await db.events.get(eventItem.id))?.completed_at).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: "整项已完成" })).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "恢复整个事项" }));
    await waitFor(async () => expect((await db.events.get(eventItem.id))?.completed_at).toBeNull());
  });
});

function eventRecord(overrides: Partial<EventItem> = {}): EventItem {
  return {
    ...syncFields(undefined, "local"),
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
