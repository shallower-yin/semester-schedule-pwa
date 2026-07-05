import { Ban, Bell, BookOpen, Check, Coffee, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { WEEKDAY_NAMES } from "../data/defaults";
import { db, queueChange } from "../db";
import {
  courseScheduleOccursOn,
  dateIsToday,
  eventOccursOn,
  formatMonthDay,
  toISODate
} from "../lib/date";
import { syncFields } from "../lib/identity";
import { buildDisplayRows, rowRangeForTime } from "../lib/timeBlocks";
import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  Semester
} from "../types";

interface WeekCalendarProps {
  dates: Date[];
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  cancellations: CourseCancellation[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
  selectedDay: number;
  onSelectedDayChange: (index: number) => void;
  onAddEvent: (date: string, start: string, end: string, allDay?: boolean) => void;
  onEditEvent: (event: EventItem) => void;
  onEditCourse: (course: Course) => void;
}

const CATEGORY_ICONS = {
  "book-open": BookOpen,
  coffee: Coffee,
  users: Users,
  bell: Bell
};

export function WeekCalendar(props: WeekCalendarProps) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const courseMap = new Map(props.courses.map((course) => [course.id, course]));
  const categoryMap = new Map(props.categories.map((category) => [category.id, category]));
  const displayRows = buildDisplayRows(
    isMobile
      ? props.periods.filter((period) => period.weekday === props.selectedDay + 1)
      : props.periods
  );

  async function toggleClassCancellation(schedule: CourseSchedule, date: Date, courseName: string) {
    const occurrenceDate = toISODate(date);
    const existing = props.cancellations.find(
      (item) => item.course_schedule_id === schedule.id && item.occurrence_date === occurrenceDate && !item.deleted_at
    );
    if (existing) {
      if (!window.confirm(`恢复 ${formatMonthDay(date)} 的“${courseName}”课程？`)) return;
      await db.courseCancellations.put({ ...existing, ...syncFields(existing), deleted_at: new Date().toISOString() });
      await queueChange("courseCancellations", existing.id, "delete");
      return;
    }
    if (!window.confirm(`将 ${formatMonthDay(date)} 的“${courseName}”标记为停课？`)) return;
    const cancellation: CourseCancellation = {
      ...syncFields(),
      course_schedule_id: schedule.id,
      occurrence_date: occurrenceDate,
      reason: ""
    };
    await db.courseCancellations.add(cancellation);
    await queueChange("courseCancellations", cancellation.id);
  }

  async function toggleCompleted(eventItem: EventItem, date: Date) {
    const occurrenceDate = toISODate(date);
    const existing = props.occurrenceStates.find(
      (state) => state.event_id === eventItem.id && state.occurrence_date === occurrenceDate && !state.deleted_at
    );
    const record: EventOccurrenceState = {
      ...syncFields(existing),
      event_id: eventItem.id,
      occurrence_date: occurrenceDate,
      completed: !existing?.completed,
      reminder_sent_at: existing?.reminder_sent_at ?? null
    };
    await db.eventOccurrenceStates.put(record);
    await queueChange("eventOccurrenceStates", record.id);
  }

  return (
    <section className="calendar-shell">
      <div className="mobile-day-switcher">
        {props.dates.map((date, index) => (
          <button
            key={toISODate(date)}
            className={`${index === props.selectedDay ? "selected" : ""} ${dateIsToday(date) ? "today" : ""}`}
            onClick={() => props.onSelectedDayChange(index)}
          >
            <span>{WEEKDAY_NAMES[index].replace("星期", "周")}</span>
            <strong>{date.getDate()}</strong>
          </button>
        ))}
      </div>

      <div
        className="week-grid"
        style={{ gridTemplateRows: `64px 44px ${displayRows.map((row) => row.kind === "break" ? "96px" : "76px").join(" ")}` }}
      >
        <div className="corner-header">时间 / 周次</div>
        {props.dates.map((date, dayIndex) => (
          <div
            key={`header-${toISODate(date)}`}
            className={`date-header day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${dateIsToday(date) ? "today" : ""}`}
            style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
          >
            <strong>{formatMonthDay(date)}</strong>
            <span>{WEEKDAY_NAMES[dayIndex]}</span>
          </div>
        ))}

        <div className="time-label all-day-label"><strong>全天</strong></div>
        {props.dates.map((date, dayIndex) => (
          <button
            key={`all-day-${toISODate(date)}`}
            className={`calendar-cell all-day-cell day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${dateIsToday(date) ? "today" : ""}`}
            style={{ gridColumn: dayIndex + 2, gridRow: 2 }}
            onClick={() => props.onAddEvent(toISODate(date), "09:00", "10:00", true)}
            aria-label={`${formatMonthDay(date)}新增全天事项`}
          />
        ))}

        {displayRows.map((row, rowIndex) => (
          <div key={`label-${row.key}`} className={`time-label ${row.kind === "break" ? "break-label" : ""}`} style={{ gridColumn: 1, gridRow: rowIndex + 3 }}>
            <strong>{row.name}</strong>
            <span>{row.startTime}–{row.endTime}</span>
          </div>
        ))}

        {props.dates.flatMap((date, dayIndex) =>
          displayRows.map((row, rowIndex) => (
            <button
              key={`${toISODate(date)}-${row.key}`}
              className={`calendar-cell day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${row.kind === "break" ? "break-cell" : ""} ${dateIsToday(date) ? "today" : ""}`}
              style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 3 }}
              onClick={() => props.onAddEvent(toISODate(date), row.startTime, row.endTime)}
              aria-label={`${formatMonthDay(date)} ${row.name}新增事项`}
            />
          ))
        )}

        {props.dates.flatMap((date, dayIndex) => {
          return props.schedules.flatMap((schedule) => {
            if (!courseScheduleOccursOn(schedule, props.semester, date)) return [];
            const course = courseMap.get(schedule.course_id);
            if (!course || course.deleted_at) return [];
            const canceled = props.cancellations.some(
              (item) => item.course_schedule_id === schedule.id && item.occurrence_date === toISODate(date) && !item.deleted_at
            );
            const startPeriod = props.periods.find(
              (period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period && !period.deleted_at
            );
            const endPeriod = props.periods.find(
              (period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period && !period.deleted_at
            );
            if (!startPeriod || !endPeriod) return [];
            const [firstRow, endRow] = rowRangeForTime(displayRows, startPeriod.start_time, endPeriod.end_time);
            return (
              <article
                key={`${schedule.id}-${toISODate(date)}`}
                className={`calendar-entry course-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${canceled ? "canceled" : ""}`}
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: `${firstRow + 3} / ${endRow + 3}`,
                  backgroundColor: course.color
                }}
                onClick={() => props.onEditCourse(course)}
              >
                <div className="entry-title"><BookOpen size={14} />{canceled ? `已停课 · ${course.name}` : course.name}</div>
                {(course.classroom || course.teacher) && <div className="entry-meta">{[course.classroom, course.teacher].filter(Boolean).join(" · ")}</div>}
                <div className="entry-time">{startPeriod?.start_time ?? ""}–{endPeriod?.end_time ?? ""}</div>
                <button
                  className="entry-icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleClassCancellation(schedule, date, course.name);
                  }}
                  title={canceled ? "恢复本次课程" : "本次停课"}
                  aria-label={canceled ? "恢复本次课程" : "本次停课"}
                >
                  <Ban size={13} />
                </button>
              </article>
            );
          });
        })}

        {props.dates.flatMap((date, dayIndex) =>
          props.events.flatMap((eventItem) => {
            if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
            const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
            const Icon = category ? CATEGORY_ICONS[category.icon as keyof typeof CATEGORY_ICONS] ?? Bell : Bell;
            const occurrenceState = props.occurrenceStates.find(
              (state) => state.event_id === eventItem.id && state.occurrence_date === toISODate(date) && !state.deleted_at
            );
            const completed = occurrenceState?.completed ?? false;
            const [firstRow, endRow] = rowRangeForTime(displayRows, eventItem.start_time, eventItem.end_time);
            return (
              <article
                key={`${eventItem.id}-${toISODate(date)}`}
                className={`calendar-entry event-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${completed ? "completed" : ""} ${eventItem.all_day ? "all-day-entry" : ""}`}
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: eventItem.all_day ? 2 : `${firstRow + 3} / ${endRow + 3}`,
                  borderLeftColor: eventItem.color || category?.color || "#e36b32"
                }}
                onClick={() => props.onEditEvent(eventItem)}
              >
                <div className="entry-title"><Icon size={14} />{eventItem.title}</div>
                {!eventItem.all_day && <div className="entry-time">{eventItem.start_time}–{eventItem.end_time}</div>}
                {category && <div className="entry-category">{category.name}</div>}
                {eventItem.reminder_enabled && <div className="entry-reminder"><Bell size={11} />提前 {eventItem.reminder_minutes_before} 分钟</div>}
                <button
                  className="entry-icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleCompleted(eventItem, date);
                  }}
                  title={completed ? "标记为未完成" : "标记完成"}
                  aria-label={completed ? "标记为未完成" : "标记完成"}
                >
                  <Check size={13} />
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
