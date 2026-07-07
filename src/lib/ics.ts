import type { ClassPeriod, Course, CourseSchedule, EventItem, Semester } from "../types";
import { addDays, eventOccursOn, parseLocalDate, toISODate } from "./date";

interface BuildIcsInput {
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  periods: ClassPeriod[];
  events: EventItem[];
}

export function buildIcsCalendar(input: BuildIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Schedule PWA//CN",
    "CALSCALE:GREGORIAN"
  ];
  const nowStamp = formatIcsDateTime(new Date());
  for (const eventItem of input.events.filter((event) => !event.deleted_at)) {
    for (const date of eventDates(eventItem, 370)) {
      lines.push(...icsEvent({
        uid: `${eventItem.id}-${toISODate(date)}@semester-schedule-pwa`,
        stamp: nowStamp,
        title: eventItem.title,
        description: eventItem.note,
        location: "",
        date,
        startTime: eventItem.all_day ? null : eventItem.start_time,
        endTime: eventItem.all_day ? null : eventItem.end_time
      }));
    }
  }
  const courseMap = new Map(input.courses.filter((course) => !course.deleted_at).map((course) => [course.id, course]));
  const periodMap = new Map(input.periods.filter((period) => !period.deleted_at).map((period) => [`${period.weekday}-${period.period_number}`, period]));
  for (const schedule of input.schedules.filter((item) => !item.deleted_at)) {
    const course = courseMap.get(schedule.course_id);
    if (!course) continue;
    const startPeriod = periodMap.get(`${schedule.weekday}-${schedule.start_period}`);
    const endPeriod = periodMap.get(`${schedule.weekday}-${schedule.end_period}`);
    if (!startPeriod || !endPeriod) continue;
    for (const week of schedule.weeks) {
      const date = addDays(parseLocalDate(input.semester.start_date), (week - 1) * 7 + schedule.weekday - 1);
      lines.push(...icsEvent({
        uid: `${schedule.id}-${week}@semester-schedule-pwa`,
        stamp: nowStamp,
        title: course.name,
        description: [course.teacher, course.note].filter(Boolean).join("\\n"),
        location: course.classroom,
        date,
        startTime: startPeriod.start_time,
        endTime: endPeriod.end_time
      }));
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function eventDates(eventItem: EventItem, horizonDays: number): Date[] {
  const start = parseLocalDate(eventItem.start_date);
  const end = eventItem.recurrence_type === "none"
    ? parseLocalDate(eventItem.end_date)
    : parseLocalDate(eventItem.recurrence_until ?? toISODate(addDays(start, horizonDays)));
  const result: Date[] = [];
  let cursor = new Date(start);
  while (cursor <= end && result.length < horizonDays) {
    if (eventOccursOn(eventItem, cursor)) result.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return result;
}

function icsEvent(input: { uid: string; stamp: string; title: string; description: string; location: string; date: Date; startTime: string | null; endTime: string | null }): string[] {
  if (!input.startTime) {
    return [
      "BEGIN:VEVENT",
      `UID:${escapeText(input.uid)}`,
      `DTSTAMP:${input.stamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(input.date)}`,
      `SUMMARY:${escapeText(input.title)}`,
      `DESCRIPTION:${escapeText(input.description)}`,
      `LOCATION:${escapeText(input.location)}`,
      "END:VEVENT"
    ];
  }
  return [
    "BEGIN:VEVENT",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${input.stamp}`,
    `DTSTART:${formatIcsDateTime(input.date, input.startTime)}`,
    `DTEND:${formatIcsDateTime(input.date, input.endTime ?? input.startTime)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    `LOCATION:${escapeText(input.location)}`,
    "END:VEVENT"
  ];
}

function formatIcsDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatIcsDateTime(date: Date, time?: string): string {
  const [hour, minute] = (time ?? `${pad(date.getHours())}:${pad(date.getMinutes())}`).split(":").map(Number);
  return `${formatIcsDate(date)}T${pad(hour)}${pad(minute)}00`;
}

function escapeText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
