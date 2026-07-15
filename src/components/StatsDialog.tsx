import { Download } from "lucide-react";
import type { Category, ClassPeriod, Course, CourseSchedule, EventItem, EventOccurrenceState, FocusSession, Semester } from "../types";
import { addDays, eventOccursOn, startOfWeek, toISODate } from "../lib/date";
import { eventCompletionForDate } from "../lib/eventCompletion";
import { formatFocusDuration, totalFocusSeconds } from "../lib/focus";
import { buildIcsCalendar, downloadIcs } from "../lib/ics";
import { Modal } from "./Modal";

interface StatsDialogProps {
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  periods: ClassPeriod[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  focusSessions: FocusSession[];
  onClose: () => void;
}

export function StatsDialog(props: StatsDialogProps) {
  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekOccurrences = weekDates.flatMap((date) =>
    props.events.flatMap((eventItem) => eventItem.deleted_at || !eventOccursOn(eventItem, date) ? [] : [{ eventItem, date, completion: eventCompletionForDate(eventItem, props.occurrenceStates, date) }])
  );
  const completed = weekOccurrences.filter((item) => item.completion.completed).length;
  const habits = props.events.filter((event) => event.event_type === "habit" && !event.deleted_at);
  const habitOccurrences = weekDates.flatMap((date) =>
    habits.flatMap((habit) => habit.deleted_at || !eventOccursOn(habit, date) ? [] : [eventCompletionForDate(habit, props.occurrenceStates, date)])
  );
  const habitCompleted = habitOccurrences.filter((item) => item.completed).length;
  const weekFocus = props.focusSessions.filter((session) => {
    const ended = new Date(session.ended_at);
    return !session.deleted_at && ended >= weekStart && ended < addDays(weekStart, 7);
  });
  const overdue = props.events.filter((eventItem) => {
    if (eventItem.deleted_at || eventItem.event_type === "habit") return false;
    for (let daysAgo = 1; daysAgo <= 30; daysAgo += 1) {
      const date = addDays(today, -daysAgo);
      if (eventOccursOn(eventItem, date) && !eventCompletionForDate(eventItem, props.occurrenceStates, date).completed) return true;
    }
    return false;
  }).length;
  const categoryMap = new Map(props.categories.map((category) => [category.id, category]));
  const categoryStats = Array.from(
    weekOccurrences.reduce((map, item) => {
      const key = item.eventItem.category_id ?? "uncategorized";
      const current = map.get(key) ?? { id: key, total: 0, completed: 0 };
      current.total += 1;
      if (item.completion.completed) current.completed += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { id: string; total: number; completed: number }>())
  ).map(([, value]) => ({
    ...value,
    label: value.id === "uncategorized" ? "未分类" : categoryMap.get(value.id)?.name ?? "已删除分类",
    rate: value.total ? Math.round((value.completed / value.total) * 100) : 0
  })).sort((left, right) => right.total - left.total);
  const eventMap = new Map(props.events.map((eventItem) => [eventItem.id, eventItem]));
  const focusByEvent = Array.from(
    weekFocus.reduce((map, session) => {
      const key = session.linked_event_id ?? "unlinked";
      map.set(key, (map.get(key) ?? 0) + session.duration_seconds);
      return map;
    }, new Map<string, number>())
  ).sort((left, right) => right[1] - left[1]).slice(0, 5);
  const heatmapDates = Array.from({ length: 28 }, (_, index) => addDays(addDays(today, -27), index));

  function exportIcs() {
    const content = buildIcsCalendar(props);
    downloadIcs(`日程计划表-${toISODate(today)}.ics`, content);
  }

  return (
    <Modal title="统计报表" onClose={props.onClose} wide>
      <div className="stats-dialog">
        <div className="health-grid">
          <article><strong>{weekOccurrences.length ? Math.round((completed / weekOccurrences.length) * 100) : 0}%</strong><span>本周完成率</span></article>
          <article><strong>{habitOccurrences.length ? Math.round((habitCompleted / habitOccurrences.length) * 100) : 0}%</strong><span>习惯打卡率</span></article>
          <article><strong>{formatFocusDuration(totalFocusSeconds(weekFocus))}</strong><span>本周专注</span></article>
          <article><strong>{overdue}</strong><span>逾期未完成</span></article>
        </div>
        <div className="overview-trend-bars stats-bars">
          {weekDates.map((date) => {
            const dayText = toISODate(date);
            const daySessions = props.focusSessions.filter((session) => !session.deleted_at && toISODate(new Date(session.ended_at)) === dayText);
            const seconds = totalFocusSeconds(daySessions);
            return (
              <div key={dayText} className={dayText === toISODate(today) ? "today" : ""}>
                <span><i style={{ height: `${Math.max(6, seconds / Math.max(1, totalFocusSeconds(weekFocus)) * 100)}%` }} /></span>
                <strong>{formatFocusDuration(seconds)}</strong>
                <small>{date.getMonth() + 1}/{date.getDate()}</small>
              </div>
            );
          })}
        </div>
        <section className="stats-section">
          <h3>分类完成率</h3>
          <div className="stats-list">
            {categoryStats.length ? categoryStats.map((item) => (
              <article key={item.id}>
                <span><strong>{item.label}</strong><small>{item.completed}/{item.total} 项</small></span>
                <b>{item.rate}%</b>
              </article>
            )) : <p>本周还没有事项记录。</p>}
          </div>
        </section>
        <section className="stats-section">
          <h3>习惯热力图</h3>
          <div className="habit-heatmap">
            {heatmapDates.map((date) => {
              const dayHabits = habits.filter((habit) => eventOccursOn(habit, date));
              const finished = dayHabits.filter((habit) => eventCompletionForDate(habit, props.occurrenceStates, date).completed).length;
              const level = dayHabits.length ? Math.ceil((finished / dayHabits.length) * 4) : 0;
              return <span key={toISODate(date)} className={`level-${level}`} title={`${toISODate(date)}：${finished}/${dayHabits.length}`} />;
            })}
          </div>
        </section>
        <section className="stats-section">
          <h3>专注关联事项</h3>
          <div className="stats-list">
            {focusByEvent.length ? focusByEvent.map(([eventId, seconds]) => (
              <article key={eventId}>
                <span><strong>{eventId === "unlinked" ? "未关联事项" : eventMap.get(eventId)?.title ?? "已删除事项"}</strong><small>本周专注</small></span>
                <b>{formatFocusDuration(seconds)}</b>
              </article>
            )) : <p>本周还没有专注记录。</p>}
          </div>
        </section>
        <div className="form-actions">
          <button className="button primary" onClick={exportIcs}><Download size={16} />导出系统日历 ICS</button>
        </div>
      </div>
    </Modal>
  );
}
