import { Ban, Bell, BookOpen, Check, CheckCircle2, Coffee, Users } from "lucide-react";
import type { CSSProperties, PointerEvent, TouchEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { WEEKDAY_NAMES } from "../data/defaults";
import { db, queueChange } from "../db";
import {
  courseScheduleOccursOn,
  dateIsToday,
  eventOccursOn,
  formatMonthDay,
  toISODate
} from "../lib/date";
import { buildEventCompletionRecord, eventCompletionForDate } from "../lib/eventCompletion";
import { eventOccurrenceMatchesStatus, type EventStatusFilter } from "../lib/eventStatusFilter";
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
  eventStatusFilter: EventStatusFilter;
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
  selectedDay: number;
  onSelectedDayChange: (index: number) => void;
  onMoveMobileWeek?: (direction: number, selectedDay: number) => void;
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

interface OverlapBlock {
  key: string;
  dayIndex: number;
  start: string;
  end: string;
  allDay: boolean;
}

interface OverlapLayout {
  index: number;
  count: number;
}

export function WeekCalendar(props: WeekCalendarProps) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const quickAddTimer = useRef<number | null>(null);
  const quickAddOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressNextBlankClick = useRef(false);
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
  const overlapLayouts = buildOverlapLayouts(props, courseMap);

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
    const completion = eventCompletionForDate(eventItem, props.occurrenceStates, date);
    const record = buildEventCompletionRecord(eventItem, completion.occurrenceDate, !completion.completed, completion.state);
    await db.eventOccurrenceStates.put(record);
    await queueChange("eventOccurrenceStates", record.id);
  }

  function clearQuickAddTimer() {
    if (quickAddTimer.current !== null) {
      window.clearTimeout(quickAddTimer.current);
      quickAddTimer.current = null;
    }
    quickAddOrigin.current = null;
  }

  function openBlankSlot(dateText: string, start: string, end: string, allDay = false) {
    if (allDay) props.onAddEvent(dateText, start, end, true);
    else props.onAddEvent(dateText, start, end);
  }

  function handleBlankCellClick(dateText: string, start: string, end: string, allDay = false) {
    if (suppressNextBlankClick.current) {
      suppressNextBlankClick.current = false;
      return;
    }
    openBlankSlot(dateText, start, end, allDay);
  }

  function startQuickAdd(event: PointerEvent<HTMLButtonElement>, dateText: string, start: string, end: string, allDay = false) {
    if (!isMobile || event.pointerType === "mouse") return;
    clearQuickAddTimer();
    quickAddOrigin.current = { x: event.clientX, y: event.clientY };
    quickAddTimer.current = window.setTimeout(() => {
      quickAddTimer.current = null;
      quickAddOrigin.current = null;
      suppressNextBlankClick.current = true;
      navigator.vibrate?.(8);
      openBlankSlot(dateText, start, end, allDay);
    }, 520);
  }

  function moveQuickAdd(event: PointerEvent<HTMLButtonElement>) {
    if (!quickAddOrigin.current) return;
    const deltaX = Math.abs(event.clientX - quickAddOrigin.current.x);
    const deltaY = Math.abs(event.clientY - quickAddOrigin.current.y);
    if (Math.max(deltaX, deltaY) > 12) clearQuickAddTimer();
  }

  function moveSelectedDay(direction: number) {
    const next = props.selectedDay + direction;
    if (next >= 0 && next <= 6) {
      props.onSelectedDayChange(next);
      return;
    }
    if (next > 6) {
      props.onMoveMobileWeek?.(1, 0);
      return;
    }
    props.onMoveMobileWeek?.(-1, 6);
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    if (!isMobile || !touchStart.current) return;
    const touch = event.changedTouches[0];
    const deltaX = touchStart.current.x - touch.clientX;
    const deltaY = touchStart.current.y - touch.clientY;
    touchStart.current = null;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    moveSelectedDay(deltaX > 0 ? 1 : -1);
  }

  function entryStyle(key: string, baseStyle: CSSProperties): CSSProperties {
    const layout = overlapLayouts.get(key);
    if (!layout || layout.count <= 1) return baseStyle;
    const gap = 4;
    return {
      ...baseStyle,
      justifySelf: "start",
      width: `calc((100% - ${gap * (layout.count - 1)}px) / ${layout.count})`,
      marginLeft: `calc(${layout.index} * ((100% - ${gap * (layout.count - 1)}px) / ${layout.count} + ${gap}px))`,
      marginRight: 0,
      zIndex: 2 + layout.index
    };
  }

  return (
    <section
      className="calendar-shell"
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        touchStart.current = null;
      }}
    >
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
        {props.dates.map((date, dayIndex) => {
          const dateText = toISODate(date);
          return (
            <button
              key={`all-day-${dateText}`}
              className={`calendar-cell all-day-cell day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${dateIsToday(date) ? "today" : ""}`}
              style={{ gridColumn: dayIndex + 2, gridRow: 2 }}
              onClick={() => handleBlankCellClick(dateText, "09:00", "10:00", true)}
              onPointerDown={(event) => startQuickAdd(event, dateText, "09:00", "10:00", true)}
              onPointerMove={moveQuickAdd}
              onPointerUp={clearQuickAddTimer}
              onPointerCancel={clearQuickAddTimer}
              onPointerLeave={clearQuickAddTimer}
              aria-label={`${formatMonthDay(date)}新增全天事项`}
              title="点击新增，长按快速新增"
            />
          );
        })}

        {displayRows.map((row, rowIndex) => (
          <div key={`label-${row.key}`} className={`time-label ${row.kind === "break" ? "break-label" : ""}`} style={{ gridColumn: 1, gridRow: rowIndex + 3 }}>
            <strong>{row.name}</strong>
            <span>{row.startTime}–{row.endTime}</span>
          </div>
        ))}

        {props.dates.flatMap((date, dayIndex) =>
          displayRows.map((row, rowIndex) => {
            const dateText = toISODate(date);
            return (
              <button
                key={`${dateText}-${row.key}`}
                className={`calendar-cell day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${row.kind === "break" ? "break-cell" : ""} ${dateIsToday(date) ? "today" : ""}`}
                style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 3 }}
                onClick={() => handleBlankCellClick(dateText, row.startTime, row.endTime)}
                onPointerDown={(event) => startQuickAdd(event, dateText, row.startTime, row.endTime)}
                onPointerMove={moveQuickAdd}
                onPointerUp={clearQuickAddTimer}
                onPointerCancel={clearQuickAddTimer}
                onPointerLeave={clearQuickAddTimer}
                aria-label={`${formatMonthDay(date)} ${row.name}新增事项`}
                title="点击新增，长按快速新增"
              />
            );
          })
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
            const occurrenceKey = `${schedule.id}-${toISODate(date)}`;
            return (
              <article
                key={occurrenceKey}
                className={`calendar-entry course-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${canceled ? "canceled" : ""} ${(overlapLayouts.get(occurrenceKey)?.count ?? 0) > 1 ? "overlap-entry" : ""}`}
                style={entryStyle(occurrenceKey, {
                  gridColumn: dayIndex + 2,
                  gridRow: `${firstRow + 3} / ${endRow + 3}`,
                  backgroundColor: course.color
                })}
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
            const isHabit = eventItem.event_type === "habit";
            const Icon = isHabit ? CheckCircle2 : category ? CATEGORY_ICONS[category.icon as keyof typeof CATEGORY_ICONS] ?? Bell : Bell;
            const completed = eventCompletionForDate(eventItem, props.occurrenceStates, date).completed;
            if (!eventOccurrenceMatchesStatus(completed, props.eventStatusFilter)) return [];
            const [firstRow, endRow] = rowRangeForTime(displayRows, eventItem.start_time, eventItem.end_time);
            const occurrenceKey = `${eventItem.id}-${toISODate(date)}`;
            return (
              <article
                key={occurrenceKey}
                className={`calendar-entry event-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${completed ? "completed" : ""} ${eventItem.all_day ? "all-day-entry" : ""} ${isHabit ? "habit-entry" : ""} ${(overlapLayouts.get(occurrenceKey)?.count ?? 0) > 1 ? "overlap-entry" : ""}`}
                style={entryStyle(occurrenceKey, {
                  gridColumn: dayIndex + 2,
                  gridRow: eventItem.all_day ? 2 : `${firstRow + 3} / ${endRow + 3}`,
                  borderLeftColor: eventItem.color || category?.color || "#e36b32"
                })}
                onClick={() => props.onEditEvent(eventItem)}
              >
                <div className="entry-title"><Icon size={14} />{eventItem.title}</div>
                {completed && <div className="entry-status">已完成</div>}
                {!eventItem.all_day && <div className="entry-time">{eventItem.start_time}–{eventItem.end_time}</div>}
                {(isHabit || category) && <div className="entry-category">{isHabit ? "习惯" : category?.name}</div>}
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

function buildOverlapLayouts(props: WeekCalendarProps, courseMap: Map<string, Course>): Map<string, OverlapLayout> {
  const blocks: OverlapBlock[] = [];

  props.dates.forEach((date, dayIndex) => {
    const dateText = toISODate(date);
    props.schedules.forEach((schedule) => {
      if (!courseScheduleOccursOn(schedule, props.semester, date)) return;
      const course = courseMap.get(schedule.course_id);
      if (!course || course.deleted_at) return;
      const canceled = props.cancellations.some(
        (item) => item.course_schedule_id === schedule.id && item.occurrence_date === dateText && !item.deleted_at
      );
      if (canceled) return;
      const startPeriod = props.periods.find(
        (period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period && !period.deleted_at
      );
      const endPeriod = props.periods.find(
        (period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period && !period.deleted_at
      );
      if (!startPeriod || !endPeriod) return;
      blocks.push({
        key: `${schedule.id}-${dateText}`,
        dayIndex,
        start: startPeriod.start_time,
        end: endPeriod.end_time,
        allDay: false
      });
    });

    props.events.forEach((eventItem) => {
      if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return;
      const completed = eventCompletionForDate(eventItem, props.occurrenceStates, date).completed;
      if (!eventOccurrenceMatchesStatus(completed, props.eventStatusFilter)) return;
      blocks.push({
        key: `${eventItem.id}-${dateText}`,
        dayIndex,
        start: eventItem.all_day ? "00:00" : eventItem.start_time ?? "00:00",
        end: eventItem.all_day ? "23:59" : eventItem.end_time ?? eventItem.start_time ?? "23:59",
        allDay: eventItem.all_day
      });
    });
  });

  return assignOverlapLayouts(blocks);
}

function assignOverlapLayouts(blocks: OverlapBlock[]): Map<string, OverlapLayout> {
  const result = new Map<string, OverlapLayout>();
  const grouped = new Map<string, OverlapBlock[]>();
  for (const block of blocks) {
    const key = `${block.dayIndex}-${block.allDay ? "all-day" : "timed"}`;
    grouped.set(key, [...(grouped.get(key) ?? []), block]);
  }

  for (const dayBlocks of grouped.values()) {
    const sorted = [...dayBlocks].sort((left, right) => {
      const startCompare = minutesOf(left.start) - minutesOf(right.start);
      if (startCompare !== 0) return startCompare;
      return minutesOf(right.end) - minutesOf(left.end);
    });
    let activeGroup: OverlapBlock[] = [];
    let activeGroupEnd = -1;

    const flush = () => {
      if (!activeGroup.length) return;
      applyLaneLayout(activeGroup, result);
      activeGroup = [];
      activeGroupEnd = -1;
    };

    for (const block of sorted) {
      const start = minutesOf(block.start);
      const end = minutesOf(block.end);
      if (activeGroup.length && start > activeGroupEnd) flush();
      activeGroup.push(block);
      activeGroupEnd = Math.max(activeGroupEnd, end);
    }
    flush();
  }
  return result;
}

function applyLaneLayout(group: OverlapBlock[], result: Map<string, OverlapLayout>) {
  if (group.length <= 1) return;
  const laneEnds: number[] = [];
  const placements: Array<{ block: OverlapBlock; index: number }> = [];
  for (const block of group) {
    const start = minutesOf(block.start);
    const end = minutesOf(block.end);
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd < start);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[laneIndex] = end;
    }
    placements.push({ block, index: laneIndex });
  }
  const count = laneEnds.length;
  if (count <= 1) return;
  for (const placement of placements) {
    result.set(placement.block.key, { index: placement.index, count });
  }
}

function minutesOf(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
