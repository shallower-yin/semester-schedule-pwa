import { courseScheduleOccursOn, eventOccursOn, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { eventOccurrenceMatchesStatus, type EventStatusFilter } from "./eventStatusFilter";
import { buildDisplayRows } from "./timeBlocks";
import type {
  Category, ClassPeriod, Course, CourseCancellation, CourseSchedule,
  EventItem, EventOccurrenceState, Semester
} from "../types";

export interface WeekCalendarInput {
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

export interface MobileCalendarEntry {
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

export interface MobileTimeGroup {
  dayIndex: number;
  start: number;
  end: number;
  entries: MobileCalendarEntry[];
}

export const MOBILE_STACK_STEP = 52;
export const MOBILE_SLOT_HEIGHT = 48;
export const MOBILE_MIN_CARD_HEIGHT = 44;
export const MOBILE_MIN_TITLE_HEIGHT = 20;

export function buildDesktopWeekLayout(props: WeekCalendarInput) {
  const courseMap = new Map(props.courses.map((course) => [course.id, course]));
  const categoryMap = new Map(props.categories.map((category) => [category.id, category]));
  const displayRows = buildDisplayRows(props.periods);
  const overlapLayouts = buildOverlapLayouts(props, courseMap);
  const rowLayout = buildStackedRowLayout(props, displayRows, overlapLayouts, props.dates);
  return { courseMap, categoryMap, displayRows, overlapLayouts, rowLayout };
}

export function buildMobileWeekLayout(props: WeekCalendarInput) {
  const rows = buildDisplayRows(props.periods);
  const entries = buildMobileEntries(props);
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
    const isLastRow = lastRow === slots.length - 1;
    // The compressed late-night row must leave one readable title line inside
    // the day boundary, even for events starting just before midnight.
    const latestTitleTop = lastRowBottom - MOBILE_MIN_TITLE_HEIGHT;
    const top = isLastRow ? Math.min(startTop, latestTitleTop) : startTop;
    const lateTitleBottom = isLastRow ? Math.max(top, ...group.entries.filter((entry) => entry.event).map((entry) =>
      Math.min(timeTop(Math.max(group.start, entry.start)), latestTitleTop) + MOBILE_MIN_TITLE_HEIGHT
    )) : top;
    const height = Math.max(
      Math.max(0, Math.min(Math.max(MOBILE_MIN_CARD_HEIGHT, endTop - startTop), lastRowBottom - top)),
      lateTitleBottom - top
    );
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
  return { entries, slots, timeTop, displayGroups, timelineHeight, allDayHeight, entriesForSlot };
}

export function buildMobileGroupLayers(
  group: MobileTimeGroup & { top: number; height: number },
  timeTop: (minute: number) => number
) {
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
    const actualTop = timeTop(Math.max(group.start, entry.start));
    const start = Math.max(0, (entry.event ? Math.min(actualTop, timeTop(1440) - MOBILE_MIN_TITLE_HEIGHT) : actualTop) - group.top);
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
  const captionHeight = Math.max(
    base.event && timeTop(Math.max(group.start, base.start)) > timeTop(1440) - MOBILE_MIN_TITLE_HEIGHT ? MOBILE_MIN_TITLE_HEIGHT : 12,
    Math.min(72, basePlacement.height, nextCover - basePlacement.top - 4)
  );
  const layerOrder = [...group.entries].sort((left, right) => left.start - right.start || right.end - left.end);
  return {
    base, layered, visibleFronts, hiddenFronts, entryPlacement, basePlacement,
    summaryTop, summaryHeight, captionHeight, layerOrder
  };
}

export function buildMobileEntries(props: WeekCalendarInput): MobileCalendarEntry[] {
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

export function formatMobileTime(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function buildStackedRowLayout(
  props: WeekCalendarInput,
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

function buildOverlapLayouts(props: WeekCalendarInput, courseMap: Map<string, Course>): Map<string, OverlapLayout> {
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

export function minutesOf(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
