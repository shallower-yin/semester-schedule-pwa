import { Download } from "lucide-react";
import type { ClassPeriod, Course, CourseSchedule, EventItem, EventOccurrenceState, FocusSession, Semester } from "../types";
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
  occurrenceStates: EventOccurrenceState[];
  focusSessions: FocusSession[];
  onClose: () => void;
}

export function StatsDialog(props: StatsDialogProps) {
  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekOccurrences = weekDates.flatMap((date) =>
    props.events.flatMap((eventItem) => eventItem.deleted_at || !eventOccursOn(eventItem, date) ? [] : [eventCompletionForDate(eventItem, props.occurrenceStates, date)])
  );
  const completed = weekOccurrences.filter((item) => item.completed).length;
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
    if (eventItem.deleted_at) return false;
    for (let daysAgo = 1; daysAgo <= 30; daysAgo += 1) {
      const date = addDays(today, -daysAgo);
      if (eventOccursOn(eventItem, date) && !eventCompletionForDate(eventItem, props.occurrenceStates, date).completed) return true;
    }
    return false;
  }).length;

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
        <div className="form-actions">
          <button className="button primary" onClick={exportIcs}><Download size={16} />导出系统日历 ICS</button>
        </div>
      </div>
    </Modal>
  );
}
