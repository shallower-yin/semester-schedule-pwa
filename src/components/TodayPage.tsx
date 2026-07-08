import { AlertCircle, CalendarCheck2, CheckCircle2, Clock3, Edit3, Target } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { EventItem, EventOccurrenceState } from "../types";
import { addDays, parseLocalDate, startOfWeek, toISODate } from "../lib/date";
import { setEventCompletedForDate, postponeEventToDate } from "../lib/eventActions";
import { formatFocusDuration } from "../lib/focus";
import type { ScheduleOverview, ScheduleOverviewItem } from "../lib/overview";

interface TodayPageProps {
  overview: ScheduleOverview;
  events: EventItem[];
  occurrenceStates: EventOccurrenceState[];
  onOpenItem: (item: ScheduleOverviewItem) => void;
  onOpenFocus: () => void;
  onAddEvent: (date: string, start: string, end: string, allDay?: boolean) => void;
}

export function TodayPage({ overview, events, occurrenceStates, onOpenItem, onOpenFocus, onAddEvent }: TodayPageProps) {
  const today = new Date();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const quickAddTimer = useRef<number | null>(null);
  const quickAddOrigin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => () => clearQuickAddTimer(), []);

  async function toggleCompleted(item: ScheduleOverviewItem) {
    const eventItem = events.find((event) => event.id === item.targetId);
    if (!eventItem) return;
    await setEventCompletedForDate(eventItem, occurrenceStates, item.occurrenceDate ? parseLocalDate(item.occurrenceDate) : today, !item.completed);
  }

  async function postpone(item: ScheduleOverviewItem, targetDate: string) {
    const eventItem = events.find((event) => event.id === item.targetId);
    if (!eventItem) return;
    await postponeEventToDate(eventItem, targetDate);
  }

  function chooseCustomDate(item: ScheduleOverviewItem) {
    const target = window.prompt("推迟到哪一天？", toISODate(addDays(today, 1)));
    if (!target) return;
    void postpone(item, target);
  }

  const weekend = toISODate(addDays(startOfWeek(today), 6));
  const tomorrow = toISODate(addDays(today, 1));
  const nextAction = overview.overdueIncompleteItems[0] ?? overview.upcomingItems.find((item) => item.type === "course" || !item.completed) ?? null;

  async function postponeItems(items: ScheduleOverviewItem[], targetDate: string) {
    for (const item of items) {
      if (item.type === "event" && !item.completed) await postpone(item, targetDate);
    }
  }

  function clearQuickAddTimer() {
    if (quickAddTimer.current !== null) {
      window.clearTimeout(quickAddTimer.current);
      quickAddTimer.current = null;
    }
    quickAddOrigin.current = null;
  }

  function startQuickAdd(event: PointerEvent<HTMLElement>) {
    if (!isMobile || event.pointerType === "mouse" || quickAddShouldIgnore(event.target)) return;
    clearQuickAddTimer();
    quickAddOrigin.current = { x: event.clientX, y: event.clientY };
    quickAddTimer.current = window.setTimeout(() => {
      quickAddTimer.current = null;
      quickAddOrigin.current = null;
      const slot = defaultTodaySlot(new Date());
      navigator.vibrate?.(8);
      onAddEvent(slot.date, slot.start, slot.end);
    }, 520);
  }

  function moveQuickAdd(event: PointerEvent<HTMLElement>) {
    if (!quickAddOrigin.current) return;
    const deltaX = Math.abs(event.clientX - quickAddOrigin.current.x);
    const deltaY = Math.abs(event.clientY - quickAddOrigin.current.y);
    if (Math.max(deltaX, deltaY) > 12) clearQuickAddTimer();
  }

  return (
    <section
      className="today-page"
      onPointerDown={startQuickAdd}
      onPointerMove={moveQuickAdd}
      onPointerUp={clearQuickAddTimer}
      onPointerCancel={clearQuickAddTimer}
      onPointerLeave={clearQuickAddTimer}
    >
      <div className="page-heading today-heading">
        <div>
          <h1>今天</h1>
          <p>{overview.todayDate} · 集中处理课程、事项、习惯和逾期未完成。</p>
        </div>
        <button className="button secondary compact" onClick={onOpenFocus}><Target size={17} />去专注</button>
      </div>

      <div className="today-stats">
        <article><CalendarCheck2 /><span><strong>{overview.todayItemCount}</strong><small>今日安排</small></span></article>
        <article><CheckCircle2 /><span><strong>{overview.todayIncompleteEventCount}</strong><small>今日未完成</small></span></article>
        <article><AlertCircle /><span><strong>{overview.overdueIncompleteItems.length}</strong><small>逾期未完成</small></span></article>
        <article><Target /><span><strong>{formatFocusDuration(overview.todayFocusSeconds)}</strong><small>今日专注</small></span></article>
      </div>

      <section className={`next-action-panel ${nextAction ? "" : "resting"}`}>
        {nextAction ? (
          <>
            <div>
              <span>接下来</span>
              <strong>{nextAction.title}</strong>
              <small>{nextAction.timeLabel} · {nextAction.subtitle}</small>
            </div>
            <button className="button primary compact" onClick={() => onOpenItem(nextAction)}><Edit3 size={15} />处理</button>
          </>
        ) : (
          <div>
            <span>接下来</span>
            <strong>无事项，可以休息啦</strong>
            <small>今天需要处理的事项已经清空。</small>
          </div>
        )}
      </section>

      <TodayList
        title="今日安排"
        items={overview.upcomingItems}
        emptyText="今天暂无安排。"
        onOpenItem={onOpenItem}
        onToggleCompleted={toggleCompleted}
        onPostpone={postpone}
        onPostponeAll={(targetDate) => postponeItems(overview.upcomingItems, targetDate)}
        onCustomPostpone={chooseCustomDate}
        tomorrow={tomorrow}
        weekend={weekend}
      />
      <TodayList
        title="逾期未完成"
        items={overview.overdueIncompleteItems}
        emptyText="最近没有逾期未完成事项。"
        onOpenItem={onOpenItem}
        onToggleCompleted={toggleCompleted}
        onPostpone={postpone}
        onPostponeAll={(targetDate) => postponeItems(overview.overdueIncompleteItems, targetDate)}
        onCustomPostpone={chooseCustomDate}
        tomorrow={tomorrow}
        weekend={weekend}
        overdue
      />
    </section>
  );
}

interface TodayListProps {
  title: string;
  items: ScheduleOverviewItem[];
  emptyText: string;
  tomorrow: string;
  weekend: string;
  overdue?: boolean;
  onOpenItem: (item: ScheduleOverviewItem) => void;
  onToggleCompleted: (item: ScheduleOverviewItem) => Promise<void>;
  onPostpone: (item: ScheduleOverviewItem, targetDate: string) => Promise<void>;
  onPostponeAll: (targetDate: string) => Promise<void>;
  onCustomPostpone: (item: ScheduleOverviewItem) => void;
}

function TodayList({ title, items, emptyText, tomorrow, weekend, overdue, onOpenItem, onToggleCompleted, onPostpone, onPostponeAll, onCustomPostpone }: TodayListProps) {
  const incompleteCount = items.filter((item) => item.type === "event" && !item.completed).length;
  return (
    <section className="today-list-section">
      <div className="section-heading">
        <div><h3>{title}</h3><p>{overdue ? "处理拖延事项，或快速推迟到新的日期。" : "课程、事项和习惯按时间排序。"}</p></div>
        {incompleteCount > 1 && <button className="button secondary compact" onClick={() => void onPostponeAll(tomorrow)}>未完成全推到明天</button>}
      </div>
      {items.length ? (
        <div className="today-list" role="list" aria-label={title}>
          {items.map((item) => (
            <article key={`${item.type}-${item.id}`} className={`today-item ${item.completed ? "completed" : ""}`} role="listitem">
              <i style={{ background: item.color }} />
              <div className="today-item-main">
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
                <small><Clock3 size={12} />{item.timeLabel}</small>
              </div>
              <div className="today-item-actions">
                {item.type === "event" && (
                  <>
                    <button className="button secondary compact" onClick={() => void onToggleCompleted(item)}>
                      <CheckCircle2 size={15} />{item.completed ? "取消完成" : "完成"}
                    </button>
                    <button className="button secondary compact" onClick={() => void onPostpone(item, tomorrow)}>明天</button>
                    <button className="button secondary compact" onClick={() => void onPostpone(item, weekend)}>周末</button>
                    <button className="button secondary compact" onClick={() => onCustomPostpone(item)}>自选</button>
                  </>
                )}
                <button className="button primary compact" onClick={() => onOpenItem(item)}><Edit3 size={15} />编辑</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty"><CalendarCheck2 size={34} /><h2>{emptyText}</h2></div>
      )}
    </section>
  );
}

function quickAddShouldIgnore(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, [role='button'], .today-item, .next-action-panel"));
}

function defaultTodaySlot(now: Date): { date: string; start: string; end: string } {
  const startMinutes = Math.min(23 * 60 + 30, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
  const endMinutes = Math.min(23 * 60 + 59, startMinutes + 30);
  return {
    date: toISODate(now),
    start: formatMinutes(startMinutes),
    end: formatMinutes(endMinutes)
  };
}

function formatMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
