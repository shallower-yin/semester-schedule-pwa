import { Ban, BookOpen, CheckCircle2, Circle, Plus } from "lucide-react";
import type { CSSProperties, PointerEvent, TouchEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { WEEKDAY_NAMES } from "../data/defaults";
import { db, putRecordAndQueue } from "../db";
import {
  courseScheduleOccursOn,
  dateIsToday,
  eventOccursOn,
  formatMonthDay,
  toISODate
} from "../lib/date";
import { eventCompletionForDate } from "../lib/eventCompletion";
import { eventOccurrenceMatchesStatus, type EventStatusFilter } from "../lib/eventStatusFilter";
import { hardDeleteLocalRecord } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { buildDisplayRows, rowRangeForTime, timePlacementForRows } from "../lib/timeBlocks";
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
import { Modal } from "./Modal";

interface WeekCalendarProps {
  dates: Date[];
  semester?: Semester | null;
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
  onToggleEventCompleted: (event: EventItem, occurrenceDate: Date, completed: boolean) => void;
  onEditCourse: (course: Course) => void;
}

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

const MOBILE_STACK_STEP = 52;
const MOBILE_SLOT_HEIGHT = 48;
const MOBILE_MIN_CARD_HEIGHT = 44;

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
  const rowLayout = buildStackedRowLayout(
    props,
    displayRows,
    overlapLayouts,
    isMobile ? [props.dates[props.selectedDay]].filter(Boolean) : props.dates
  );

  async function toggleClassCancellation(schedule: CourseSchedule, date: Date, courseName: string) {
    const occurrenceDate = toISODate(date);
    const existing = props.cancellations.find(
      (item) => item.course_schedule_id === schedule.id && item.occurrence_date === occurrenceDate && !item.deleted_at
    );
    if (existing) {
      if (!window.confirm(`恢复 ${formatMonthDay(date)} 的“${courseName}”课程？`)) return;
      await hardDeleteLocalRecord("courseCancellations", existing.id);
      return;
    }
    if (!window.confirm(`将 ${formatMonthDay(date)} 的“${courseName}”标记为停课？`)) return;
    const cancellation: CourseCancellation = {
      ...syncFields(undefined, schedule.user_id),
      course_schedule_id: schedule.id,
      occurrence_date: occurrenceDate,
      reason: ""
    };
    await putRecordAndQueue("courseCancellations", cancellation);
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
    if (layout.count >= 3 && baseStyle.gridRow === 2) {
      const column = layout.index % 2;
      const layer = Math.floor(layout.index / 2);
      return {
        ...baseStyle,
        "--overlap-count": layout.count,
        "--overlap-index": layout.index,
        justifySelf: "start",
        width: "calc(50% - 8px)",
        marginLeft: column === 0 ? "6px" : "calc(50% + 2px)",
        marginRight: 0,
        transform: `translateY(${layer * MOBILE_STACK_STEP}px)`,
        zIndex: 2 + layout.index
      } as CSSProperties & { "--overlap-count": number; "--overlap-index": number };
    }
    const gap = 4;
    return {
      ...baseStyle,
      "--overlap-count": layout.count,
      "--overlap-index": layout.index,
      justifySelf: "start",
      width: `calc((100% - ${gap * (layout.count - 1)}px) / ${layout.count})`,
      marginLeft: `calc(${layout.index} * ((100% - ${gap * (layout.count - 1)}px) / ${layout.count} + ${gap}px))`,
      marginRight: 0,
      zIndex: 2 + layout.index
    } as CSSProperties & { "--overlap-count": number; "--overlap-index": number };
  }

  function overlapClass(key: string): string {
    const count = overlapLayouts.get(key)?.count ?? 0;
    if (count <= 1) return "";
    if (count === 2) return "overlap-entry overlap-two";
    if (count === 3) return "overlap-entry overlap-three";
    return "overlap-entry overlap-many";
  }

  if (isMobile) {
    return (
      <MobileWeekCalendar
        {...props}
        onBlankClick={handleBlankCellClick}
        onBlankPointerDown={startQuickAdd}
        onBlankPointerMove={moveQuickAdd}
        onBlankPointerEnd={clearQuickAddTimer}
        onToggleClassCancellation={toggleClassCancellation}
      />
    );
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
        style={{ gridTemplateRows: `64px ${rowLayout.allDayHeight} ${rowLayout.rowHeights.join(" ")}` }}
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
          <div key={`label-${row.key}`} className={`time-label ${row.kind === "break" ? "break-label" : ""} ${row.kind === "boundary" ? "boundary-label" : ""}`} style={{ gridColumn: 1, gridRow: rowIndex + 3 }}>
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
                className={`calendar-cell day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${row.kind === "break" ? "break-cell" : ""} ${row.kind === "boundary" ? "boundary-cell" : ""} ${dateIsToday(date) ? "today" : ""}`}
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
          const semester = props.semester;
          if (!semester) return [];
          return props.schedules.flatMap((schedule) => {
            if (!courseScheduleOccursOn(schedule, semester, date)) return [];
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
                className={`calendar-entry course-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${canceled ? "canceled" : ""} ${overlapClass(occurrenceKey)}`}
                style={entryStyle(occurrenceKey, {
                  gridColumn: dayIndex + 2,
                  gridRow: `${firstRow + 3} / ${endRow + 3}`,
                  "--course-color": course.color
                } as CSSProperties)}
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
            const completed = eventCompletionForDate(eventItem, props.occurrenceStates, date).completed;
            if (!eventOccurrenceMatchesStatus(completed, props.eventStatusFilter)) return [];
            const placement = timePlacementForRows(displayRows, eventItem.start_time, eventItem.end_time);
            const firstRowHeight = displayRows[placement.firstRow]?.kind === "break" ? 96 : 76;
            const lastRowHeight = displayRows[placement.endRow - 1]?.kind === "break" ? 96 : 76;
            const occurrenceKey = `${eventItem.id}-${toISODate(date)}`;
            return (
              <article
                key={occurrenceKey}
                className={`calendar-entry event-entry day-column day-${dayIndex} ${dayIndex === props.selectedDay ? "mobile-selected" : ""} ${completed ? "completed" : ""} ${eventItem.all_day ? "all-day-entry" : ""} ${isHabit ? "habit-entry" : ""} ${overlapClass(occurrenceKey)}`}
                style={entryStyle(occurrenceKey, {
                  gridColumn: dayIndex + 2,
                  gridRow: eventItem.all_day ? 2 : `${placement.firstRow + 3} / ${placement.endRow + 3}`,
                  ...(eventItem.all_day ? {} : {
                    "--time-start-offset": `${placement.startOffset * firstRowHeight}px`,
                    "--time-end-offset": `${placement.endOffset * lastRowHeight}px`
                  }),
                  borderLeftColor: eventItem.color || category?.color || "#e36b32"
                } as CSSProperties)}
                onClick={() => props.onEditEvent(eventItem)}
              >
                <div className="entry-title">{eventItem.title}</div>
                {!eventItem.all_day && <div className="entry-time">{eventItem.start_time}–{eventItem.end_time}</div>}
                {eventItem.location?.trim() && <div className="entry-location">{eventItem.location.trim()}</div>}
                {(isHabit || category) && <div className="entry-category">{isHabit ? "习惯" : category?.name}</div>}
                {eventItem.reminder_enabled && <div className="entry-reminder">提前 {eventItem.reminder_minutes_before} 分钟提醒</div>}
                <button
                  className={`entry-icon-button event-complete-button ${completed ? "completed" : ""}`}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    props.onToggleEventCompleted(eventItem, date, !completed);
                  }}
                  title={completed ? `将 ${toISODate(date)} 标记为未完成` : `将 ${toISODate(date)} 标记为已完成`}
                  aria-label={completed ? `将 ${eventItem.title} 标记为未完成` : `将 ${eventItem.title} 标记为已完成`}
                >
                  {completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

interface MobileCalendarEntry {
  key: string;
  dayIndex: number;
  title: string;
  location: string;
  time: string;
  start: number;
  end: number;
  color: string;
  allDay: boolean;
  completed: boolean;
  canceled: boolean;
  event?: EventItem;
  course?: Course;
  schedule?: CourseSchedule;
}

interface MobileTimeGroup {
  dayIndex: number;
  start: number;
  end: number;
  entries: MobileCalendarEntry[];
}

interface MobileWeekCalendarProps extends WeekCalendarProps {
  onBlankClick: (date: string, start: string, end: string, allDay?: boolean) => void;
  onBlankPointerDown: (event: PointerEvent<HTMLButtonElement>, date: string, start: string, end: string, allDay?: boolean) => void;
  onBlankPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onBlankPointerEnd: () => void;
  onToggleClassCancellation: (schedule: CourseSchedule, date: Date, courseName: string) => Promise<void>;
}

function MobileWeekCalendar(props: MobileWeekCalendarProps) {
  const rows = buildDisplayRows(props.periods);
  const entries = buildMobileEntries(props);
  const [selectedSlot, setSelectedSlot] = useState<{
    dayIndex: number;
    rowIndex: number;
    entryKeys?: string[];
    rangeStart?: number;
    rangeEnd?: number;
  } | null>(null);
  const slots = rows.map((row, rowIndex) => ({ ...row, rowIndex, start: minutesOf(row.startTime), end: minutesOf(row.endTime) }));
  const separators = slots.filter((row) => row.kind !== "period");
  const timeTop = (minute: number) => {
    const rowIndex = slots.findIndex((row) => minute < row.end);
    if (rowIndex < 0) return slots.length * MOBILE_SLOT_HEIGHT;
    const row = slots[rowIndex];
    return (rowIndex + Math.min(1, Math.max(0, (minute - row.start) / Math.max(1, row.end - row.start)))) * MOBILE_SLOT_HEIGHT;
  };
  const overlapGroups: MobileTimeGroup[] = [];
  props.dates.forEach((_, dayIndex) => {
    const timed = entries.filter((entry) => entry.dayIndex === dayIndex && !entry.allDay)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    let current: MobileTimeGroup | undefined;
    timed.forEach((entry) => {
      if (!current || entry.start >= current.end) {
        current = { dayIndex, start: entry.start, end: entry.end, entries: [entry] };
        overlapGroups.push(current);
      } else {
        current.entries.push(entry);
        current.end = Math.max(current.end, entry.end);
      }
    });
  });
  const groups = overlapGroups.flatMap((group) => {
    const cuts = [...new Set([
      group.start,
      ...separators.map((row) => row.start)
        .filter((point) => point > group.start && point < group.end),
      group.end
    ])].sort((left, right) => left - right);
    return cuts.slice(0, -1).map((start, index) => ({
      dayIndex: group.dayIndex,
      start,
      end: cuts[index + 1],
      entries: group.entries.filter((entry) => entry.start < cuts[index + 1] && entry.end > start)
    }));
  });
  const displayGroups: Array<MobileTimeGroup & { top: number; height: number }> = [];
  for (const group of groups) {
    const startTop = timeTop(group.start);
    const endTop = Math.max(startTop + 1, timeTop(group.end));
    const lastRow = slots.findIndex((row) => group.end <= row.end);
    const lastRowBottom = (lastRow < 0 ? slots.length : lastRow + 1) * MOBILE_SLOT_HEIGHT;
    const top = startTop;
    const height = Math.max(0, Math.min(Math.max(MOBILE_MIN_CARD_HEIGHT, endTop - startTop), lastRowBottom - top));
    const previous = displayGroups.at(-1);
    if (previous?.dayIndex === group.dayIndex && top < previous.top + previous.height - 0.1) {
      const bottom = Math.max(previous.top + previous.height, top + height);
      previous.top = Math.min(previous.top, top);
      previous.height = bottom - previous.top;
      previous.start = Math.min(previous.start, group.start);
      previous.end = Math.max(previous.end, group.end);
      previous.entries = [...new Map([...previous.entries, ...group.entries].map((entry) => [entry.key, entry])).values()];
    } else {
      displayGroups.push({ ...group, top, height });
    }
  }
  const timelineHeight = slots.length * MOBILE_SLOT_HEIGHT;
  const allDayCount = Math.max(0, ...props.dates.map((_, dayIndex) => entries.filter((entry) => entry.dayIndex === dayIndex && entry.allDay).length));
  const allDayHeight = allDayCount ? allDayCount * 52 : 26;
  const entriesForSlot = (dayIndex: number, rowIndex: number) => entries.filter((entry) => {
    if (entry.dayIndex !== dayIndex || entry.allDay) return false;
    const top = timeTop(entry.start);
    const bottom = Math.max(top + 1, timeTop(entry.end));
    return top < (rowIndex + 1) * MOBILE_SLOT_HEIGHT && bottom > rowIndex * MOBILE_SLOT_HEIGHT;
  });
  const selectedRow = selectedSlot ? slots[selectedSlot.rowIndex] : undefined;
  const selectedEntries = selectedSlot?.entryKeys
    ? entries.filter((entry) => selectedSlot.entryKeys!.includes(entry.key))
    : selectedSlot ? entriesForSlot(selectedSlot.dayIndex, selectedSlot.rowIndex) : [];
  const slotTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  // HTML time inputs cannot represent 24:00. The final slot keeps its actual
  // boundary while a new draft gets the last selectable minute of this date.
  const draftEnd = (end: number) => slotTime(Math.min(1439, end));
  const selectedStart = selectedSlot?.rangeStart !== undefined ? slotTime(selectedSlot.rangeStart) : selectedRow?.startTime;
  const selectedEnd = selectedSlot?.rangeEnd !== undefined ? slotTime(selectedSlot.rangeEnd) : selectedRow?.endTime;

  function openGroupEntries(group: MobileTimeGroup, items: MobileCalendarEntry[]) {
    const start = Math.min(...items.map((entry) => entry.start));
    const end = Math.max(...items.map((entry) => entry.end));
    setSelectedSlot({
      dayIndex: group.dayIndex,
      rowIndex: Math.max(0, slots.findIndex((row) => start < row.end)),
      entryKeys: items.map((entry) => entry.key),
      rangeStart: start,
      rangeEnd: end
    });
  }

  function renderLayerCard(entry: MobileCalendarEntry, role: "base" | "front", top: number, height: number, captionHeight: number, index = 0, layerOrder = 0) {
    const isBase = role === "base";
    return (
      <button
        key={entry.key}
        type="button"
        className={`mobile-week-card mobile-week-visual-card mobile-week-layer-card mobile-week-layer-${role} ${isBase ? "" : "short"} ${entry.completed ? "completed" : ""} ${entry.canceled ? "canceled" : ""}`}
        data-layer-role={role}
        data-entry-key={entry.key}
        style={{
          "--entry-color": entry.color,
          top,
          height,
          ...(height < MOBILE_MIN_CARD_HEIGHT ? { minHeight: 0 } : {}),
          left: isBase || index % 2 ? 2 : 6,
          right: !isBase && index % 2 ? 6 : 2,
          zIndex: 1 + layerOrder
        } as CSSProperties}
        aria-label={`编辑${entry.event ? "事项" : "课程"}：${entry.title}`}
        title={[entry.title, entry.time, entry.location].filter(Boolean).join(" · ")}
        onClick={() => entry.event ? props.onEditEvent(entry.event) : entry.course && props.onEditCourse(entry.course)}
      >
        <span className="mobile-week-layer-caption" style={{ height: captionHeight }}>
          <span className="mobile-week-card-title">{entry.canceled ? "已停课 · " : ""}{entry.title}</span>
          {(!isBase || captionHeight >= 64) && <span className="mobile-week-card-time"><span>{slotTime(entry.start)}</span><span>–{entry.time.split("–")[1]}</span></span>}
        </span>
      </button>
    );
  }

  function renderCard(entry: MobileCalendarEntry, continuation = false) {
    const date = props.dates[entry.dayIndex];
    const [displayStart, displayEnd] = entry.time.split("–");
    return (
      <article
        key={entry.key}
        className={`mobile-week-card ${entry.event ? "mobile-event-card" : "mobile-course-card"} ${entry.allDay ? "mobile-all-day-card" : ""} ${entry.completed ? "completed" : ""} ${entry.canceled ? "canceled" : ""}`}
        style={{ "--entry-color": entry.color } as CSSProperties}
        data-occurrence-date={toISODate(date)}
      >
        <button
          type="button"
          className="mobile-week-card-open"
          onClick={() => entry.event ? props.onEditEvent(entry.event) : entry.course && props.onEditCourse(entry.course)}
          aria-label={`编辑${entry.event ? "事项" : "课程"}：${entry.title}`}
          title={[entry.title, entry.time, entry.location].filter(Boolean).join(" · ")}
        >
          <span className="mobile-week-card-title">{continuation ? "续 · " : ""}{entry.canceled ? "已停课 · " : ""}{entry.title}</span>
          {!entry.allDay && <span className="mobile-week-card-time"><span>{formatMobileTime(minutesOf(displayStart))}</span><span>–{formatMobileTime(minutesOf(displayEnd))}</span></span>}
          {entry.location && <span className="mobile-week-card-location" title={entry.location}>{entry.location}</span>}
        </button>
        {!continuation && (entry.event ? (
          <button
            type="button"
            className="mobile-week-card-action"
            onClick={() => props.onToggleEventCompleted(entry.event!, date, !entry.completed)}
            aria-label={`将 ${entry.title} 标记为${entry.completed ? "未完成" : "已完成"}`}
            title={entry.completed ? "标记未完成" : "标记完成"}
          >
            {entry.completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          </button>
        ) : entry.schedule && entry.course && (
          <button
            type="button"
            className="mobile-week-card-action"
            onClick={() => void props.onToggleClassCancellation(entry.schedule!, date, entry.course!.name)}
            aria-label={`${entry.canceled ? "恢复" : "停课"}：${entry.title} ${toISODate(date)}`}
            title={entry.canceled ? "恢复本次课程" : "本次停课"}
          >
            <Ban size={12} /><span>{entry.canceled ? "恢复" : "停课"}</span>
          </button>
        ))}
      </article>
    );
  }

  return (
    <section className="calendar-shell mobile-week-calendar" aria-label="一周日程">
      <div className="mobile-week-scroll">
        <div className="mobile-week-dates">
          {props.dates.map((date, dayIndex) => (
            <button
              key={toISODate(date)}
              type="button"
              className={dateIsToday(date) ? "today" : ""}
              aria-label={`${formatMonthDay(date)} ${WEEKDAY_NAMES[dayIndex]}`}
              aria-current={dateIsToday(date) ? "date" : undefined}
              aria-pressed={dayIndex === props.selectedDay}
              onClick={() => props.onSelectedDayChange(dayIndex)}
            >
              <span>{WEEKDAY_NAMES[dayIndex].replace("星期", "周")}</span>
              <strong>{date.getDate()}</strong>
            </button>
          ))}
        </div>
        <div className="mobile-week-all-day" style={{ minHeight: allDayHeight }}>
          {props.dates.map((date, dayIndex) => (
            <div key={toISODate(date)} className={`mobile-week-all-day-column ${entries.some((entry) => entry.dayIndex === dayIndex && entry.allDay) ? "has-items" : ""}`}>
              <button
                type="button"
                className="mobile-week-all-day-add"
                aria-label={`${formatMonthDay(date)}新增全天事项`}
                onClick={() => props.onBlankClick(toISODate(date), "09:00", "10:00", true)}
              ><Plus size={11} /><span>全天</span></button>
              {entries.filter((entry) => entry.dayIndex === dayIndex && entry.allDay).map((entry) => renderCard(entry))}
            </div>
          ))}
        </div>
        <div className="mobile-week-timeline" style={{ height: timelineHeight }}>
          {slots.map((row) => (
            <div
              key={row.key}
              className={`mobile-week-time-band mobile-week-slot-row ${row.kind !== "period" ? "rest-slot" : ""}`}
              data-start-minute={row.start}
              data-end-minute={row.end}
              style={{ top: row.rowIndex * MOBILE_SLOT_HEIGHT, height: MOBILE_SLOT_HEIGHT }}
            >
              {row.kind !== "period" && (
                <div
                  className="mobile-week-time-band mobile-week-time-separator rest"
                  role="separator"
                  aria-label={`${row.name} ${row.startTime}–${row.endTime}`}
                  style={{ top: 0, height: MOBILE_SLOT_HEIGHT }}
                >
                  <span className="mobile-week-band-label">{row.name} <span>{row.startTime}–{row.endTime}</span></span>
                </div>
              )}
              {props.dates.map((date, dayIndex) => {
                const matching = entriesForSlot(dayIndex, row.rowIndex);
                const label = `${formatMonthDay(date)} ${row.startTime}–${row.endTime}`;
                return (
                <button
                  type="button"
                  key={toISODate(date)}
                  className={`mobile-week-blank ${matching.length ? "has-entries" : ""}`}
                  aria-label={`${label}${matching.length ? `查看${matching.length}项日程` : "新增事项"}`}
                  onClick={() => matching.length ? setSelectedSlot({ dayIndex, rowIndex: row.rowIndex }) : props.onBlankClick(toISODate(date), row.startTime, draftEnd(row.end))}
                  onPointerDown={(event) => !matching.length && props.onBlankPointerDown(event, toISODate(date), row.startTime, draftEnd(row.end))}
                  onPointerMove={props.onBlankPointerMove}
                  onPointerUp={props.onBlankPointerEnd}
                  onPointerCancel={props.onBlankPointerEnd}
                  onPointerLeave={props.onBlankPointerEnd}
                >
                  <span className="mobile-week-slot-time">{row.startTime}</span>
                </button>
                );
              })}
            </div>
          ))}
          {displayGroups.map((group) => {
            const ordered = [...group.entries].sort((left, right) =>
              (right.end - right.start) - (left.end - left.start) || left.start - right.start || left.key.localeCompare(right.key)
            );
            const base = ordered[0];
            const fronts = ordered.slice(1).sort((left, right) =>
              (left.end - left.start) - (right.end - right.start) || left.start - right.start || left.key.localeCompare(right.key)
            );
            const capacity = Math.max(0, Math.floor((group.height - MOBILE_MIN_CARD_HEIGHT) / (MOBILE_MIN_CARD_HEIGHT + 4)));
            const layered = group.entries.length > 1 && capacity > 0;
            const visibleFronts = fronts.length <= capacity ? fronts : fronts.slice(0, Math.max(0, capacity - 1));
            const hiddenFronts = fronts.slice(visibleFronts.length);
            const entryPlacement = (entry: MobileCalendarEntry) => {
              const start = Math.max(0, timeTop(Math.max(group.start, entry.start)) - group.top);
              const end = Math.min(group.height, timeTop(Math.min(group.end, entry.end)) - group.top);
              const height = Math.max(0, Math.min(group.height - start, Math.max(MOBILE_MIN_CARD_HEIGHT, end - start)));
              return { top: start, height };
            };
            const basePlacement = entryPlacement(base);
            const summaryTop = hiddenFronts.length
              ? Math.min(...hiddenFronts.map((entry) => entryPlacement(entry).top))
              : group.height;
            const summaryHeight = Math.max(0, Math.min(MOBILE_MIN_CARD_HEIGHT, group.height - summaryTop));
            const nextCover = Math.min(
              group.height,
              ...visibleFronts.map((entry) => entryPlacement(entry).top).filter((top) => top > basePlacement.top),
              ...(summaryTop > basePlacement.top ? [summaryTop] : [])
            );
            const captionHeight = Math.max(12, Math.min(72, basePlacement.height, nextCover - basePlacement.top - 4));
            const layerOrder = [...group.entries].sort((left, right) => left.start - right.start || right.end - left.end);
            return (
            <div
              key={`${group.dayIndex}-${group.start}`}
              className={`mobile-week-time-group ${group.entries.length > 1 ? "overlapping" : ""} ${layered ? "layered" : ""}`}
              role={group.entries.length > 1 ? "group" : undefined}
              aria-label={group.entries.length > 1 ? `${formatMobileTime(group.start)}–${formatMobileTime(group.end)}，${group.entries.length}项安排` : undefined}
              data-start-minute={group.start}
              data-end-minute={group.end}
              style={{
                "--day-index": group.dayIndex,
                top: group.top,
                height: group.height
              } as CSSProperties}
            >
              {layered ? (
                <>
                  {renderLayerCard(base, "base", basePlacement.top, basePlacement.height, captionHeight, 0, layerOrder.indexOf(base))}
                  {visibleFronts.map((entry, index) => {
                    const placement = entryPlacement(entry);
                    return renderLayerCard(entry, "front", placement.top, placement.height, Math.min(72, placement.height), index, layerOrder.indexOf(entry));
                  })}
                  {hiddenFronts.length > 0 && (
                    <button
                      type="button"
                      className="mobile-week-layer-summary"
                      aria-label={`查看另外${hiddenFronts.length}项安排`}
                      style={{ top: summaryTop, height: summaryHeight, ...(summaryHeight < MOBILE_MIN_CARD_HEIGHT ? { minHeight: 0 } : {}), left: visibleFronts.length % 2 ? 2 : 6, right: visibleFronts.length % 2 ? 6 : 2 }}
                      onClick={() => openGroupEntries(group, hiddenFronts)}
                    >另{hiddenFronts.length}项</button>
                  )}
                </>
              ) : group.entries.length > 1 ? (
                <button type="button" className="mobile-week-overlap-summary" aria-label={`查看${group.entries.length}项安排`} onClick={() => openGroupEntries(group, group.entries)}>{group.entries.length}项安排</button>
              ) : group.entries.map((entry) => {
                const height = group.height;
                const startsInRest = slots.find((row) => group.start < row.end)?.kind !== "period";
                return (
                  <article
                    key={entry.key}
                    className={`mobile-week-card mobile-week-visual-card ${height < 72 || startsInRest ? "short" : ""} ${entry.completed ? "completed" : ""} ${entry.canceled ? "canceled" : ""}`}
                    style={{ "--entry-color": entry.color } as CSSProperties}
                    data-occurrence-date={toISODate(props.dates[entry.dayIndex])}
                  >
                    <span className="mobile-week-card-title">{entry.start < group.start ? "续 · " : ""}{entry.canceled ? "已停课 · " : ""}{entry.title}</span>
                    <span className="mobile-week-card-time"><span>{slotTime(entry.start)}</span><span>–{entry.time.split("–")[1]}</span></span>
                    {height >= 96 && !startsInRest && entry.location && <span className="mobile-week-card-location">{entry.location}</span>}
                  </article>
                );
              })}
            </div>
          );
          })}
        </div>
      </div>
      {selectedSlot && selectedRow && (
        <Modal title="选择日程" className="mobile-week-selection" onClose={() => setSelectedSlot(null)}>
          <p className="mobile-week-selection-range">{formatMonthDay(props.dates[selectedSlot.dayIndex])} {selectedStart}–{selectedEnd}</p>
          <div className="mobile-week-selection-list">
            {selectedEntries.map((entry) => (
              <article key={entry.key} className={`${entry.completed ? "completed" : ""} ${entry.canceled ? "canceled" : ""}`} style={{ "--entry-color": entry.color } as CSSProperties}>
                <button type="button" className="mobile-week-selection-edit" aria-label={`编辑${entry.event ? "事项" : "课程"}：${entry.title}`} onClick={() => {
                  setSelectedSlot(null);
                  if (entry.event) props.onEditEvent(entry.event);
                  else if (entry.course) props.onEditCourse(entry.course);
                }}>
                  <strong>{entry.title}</strong>
                  <span>{entry.time}{entry.location ? ` · ${entry.location}` : ""}</span>
                </button>
                {entry.event ? (
                  <button type="button" className="button secondary compact" aria-label={`将 ${entry.title} 标记为${entry.completed ? "未完成" : "已完成"}`} onClick={() => props.onToggleEventCompleted(entry.event!, props.dates[selectedSlot.dayIndex], !entry.completed)}>
                    {entry.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}{entry.completed ? "标记未完成" : "标记完成"}
                  </button>
                ) : entry.course && entry.schedule && (
                  <button type="button" className="button secondary compact" aria-label={`${entry.canceled ? "恢复" : "停课"}：${entry.title} ${toISODate(props.dates[selectedSlot.dayIndex])}`} onClick={() => void props.onToggleClassCancellation(entry.schedule!, props.dates[selectedSlot.dayIndex], entry.course!.name)}>
                    <Ban size={15} />{entry.canceled ? "恢复本次课程" : "本次停课"}
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className="form-actions"><button type="button" className="button primary" onClick={() => {
            props.onBlankClick(toISODate(props.dates[selectedSlot.dayIndex]), selectedStart!, draftEnd(selectedSlot.rangeEnd ?? selectedRow.end));
            setSelectedSlot(null);
          }}><Plus size={17} />新增事项</button></div>
        </Modal>
      )}
    </section>
  );
}

function buildMobileEntries(props: WeekCalendarProps): MobileCalendarEntry[] {
  const entries: MobileCalendarEntry[] = [];
  const courseMap = new Map(props.courses.map((course) => [course.id, course]));
  const categoryMap = new Map(props.categories.map((category) => [category.id, category]));
  props.dates.forEach((date, dayIndex) => {
    const dateText = toISODate(date);
    if (props.semester) props.schedules.forEach((schedule) => {
      if (!courseScheduleOccursOn(schedule, props.semester!, date)) return;
      const course = courseMap.get(schedule.course_id);
      if (!course || course.deleted_at) return;
      const start = props.periods.find((period) => !period.deleted_at && period.weekday === schedule.weekday && period.period_number === schedule.start_period);
      const end = props.periods.find((period) => !period.deleted_at && period.weekday === schedule.weekday && period.period_number === schedule.end_period);
      if (!start || !end) return;
      entries.push({
        key: `${schedule.id}-${dateText}`, dayIndex, title: course.name, location: course.classroom ?? "",
        start: minutesOf(start.start_time), end: Math.max(minutesOf(start.start_time) + 1, minutesOf(end.end_time)),
        time: `${start.start_time.slice(0, 5)}–${end.end_time.slice(0, 5)}`, color: course.color, allDay: false, completed: false,
        canceled: props.cancellations.some((item) => !item.deleted_at && item.course_schedule_id === schedule.id && item.occurrence_date === dateText),
        course, schedule
      });
    });
    props.events.forEach((event) => {
      if (event.deleted_at || !eventOccursOn(event, date)) return;
      const completed = eventCompletionForDate(event, props.occurrenceStates, date).completed;
      if (!eventOccurrenceMatchesStatus(completed, props.eventStatusFilter)) return;
      const start = Math.min(1439, Math.max(0, minutesOf(event.start_time ?? "00:00")));
      const end = Math.min(1440, Math.max(start + 1, minutesOf(event.end_time ?? event.start_time ?? "00:00")));
      entries.push({
        key: `${event.id}-${dateText}`, dayIndex, title: event.title, location: event.location?.trim() ?? "",
        start, end, time: event.all_day ? "全天" : `${event.start_time?.slice(0, 5) ?? "00:00"}–${event.end_time?.slice(0, 5) ?? event.start_time?.slice(0, 5) ?? "00:00"}`,
        color: event.color || categoryMap.get(event.category_id ?? "")?.color || "var(--brand-primary)",
        allDay: event.all_day, completed, canceled: false, event
      });
    });
  });
  return entries;
}

function formatMobileTime(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function buildStackedRowLayout(
  props: WeekCalendarProps,
  displayRows: ReturnType<typeof buildDisplayRows>,
  overlapLayouts: Map<string, OverlapLayout>,
  dates: Date[]
) {
  let allDayCount = 1;
  if (!dates.length) {
    return {
      allDayHeight: "44px",
      rowHeights: displayRows.map((row) => row.kind === "break" ? "96px" : "76px")
    };
  }
  dates.forEach((date) => {
    const dateText = toISODate(date);
    props.events.forEach((eventItem) => {
      if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return;
      const completed = eventCompletionForDate(eventItem, props.occurrenceStates, date).completed;
      if (!eventOccurrenceMatchesStatus(completed, props.eventStatusFilter)) return;
      const count = overlapLayouts.get(`${eventItem.id}-${dateText}`)?.count ?? 1;
      if (eventItem.all_day) {
        allDayCount = Math.max(allDayCount, count);
        return;
      }
    });
  });

  return {
    allDayHeight: `${allDayCount >= 3 ? Math.max(44, Math.ceil(allDayCount / 2) * MOBILE_STACK_STEP + 14) : 44}px`,
    rowHeights: displayRows.map((row) => row.kind === "break" ? "96px" : "76px")
  };
}

function buildOverlapLayouts(props: WeekCalendarProps, courseMap: Map<string, Course>): Map<string, OverlapLayout> {
  const blocks: OverlapBlock[] = [];
  const semester = props.semester;

  props.dates.forEach((date, dayIndex) => {
    const dateText = toISODate(date);
    if (semester) props.schedules.forEach((schedule) => {
      if (!courseScheduleOccursOn(schedule, semester, date)) return;
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
      if (activeGroup.length && start >= activeGroupEnd) flush();
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
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= start);
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
