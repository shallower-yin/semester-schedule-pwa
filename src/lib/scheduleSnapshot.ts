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
import { courseScheduleOccursOn, eventOccursOn, formatMonthDay, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { canvasToPngBlob, exportBlob } from "./fileExport";
import { THEME_SKINS, type ThemeSkinId } from "./themeSkins";

export interface SnapshotScheduleItem {
  id: string;
  title: string;
  time: string;
  detail: string;
  color: string;
  completed: boolean;
  kind: "course" | "event" | "habit";
  startMinute?: number;
  endMinute?: number;
  allDay?: boolean;
  details?: string[];
  continuation?: string;
}

export interface SnapshotDay {
  date: Date;
  items: SnapshotScheduleItem[];
  restPeriods?: { name: string; startMinute: number; endMinute: number }[];
}

export interface ScheduleSnapshotInput {
  semester: Semester | null;
  courses: Course[];
  schedules: CourseSchedule[];
  cancellations: CourseCancellation[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
}

export interface SnapshotTemplateConfig {
  brandText: string;
  footerText: string;
  backgroundImageUrl: string | null;
}

// Keep all editable copy and future background artwork in one place.
export const SCHEDULE_SNAPSHOT_TEMPLATE: SnapshotTemplateConfig = {
  brandText: "日程计划表",
  footerText: "按自己的节奏，完成重要的事",
  backgroundImageUrl: null
};

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildSnapshotDays(input: ScheduleSnapshotInput, dates: Date[]): SnapshotDay[] {
  const courseMap = new Map(input.courses.map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.map((category) => [category.id, category]));
  return dates.map((date) => {
    const dateText = toISODate(date);
    const courses = input.semester ? input.schedules.flatMap((schedule): SnapshotScheduleItem[] => {
      if (!courseScheduleOccursOn(schedule, input.semester!, date)) return [];
      if (input.cancellations.some((item) => item.course_schedule_id === schedule.id && item.occurrence_date === dateText && !item.deleted_at)) return [];
      const course = courseMap.get(schedule.course_id);
      if (!course || course.deleted_at) return [];
      const start = input.periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period && !period.deleted_at);
      const end = input.periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period && !period.deleted_at);
      return [{
        id: `${schedule.id}-${dateText}`,
        title: course.name,
        time: start && end ? `${start.start_time.slice(0, 5)}-${end.end_time.slice(0, 5)}` : `第 ${schedule.start_period}-${schedule.end_period} 节`,
        detail: [course.classroom, course.teacher].filter(Boolean).join(" · "),
        color: course.color,
        completed: false,
        kind: "course",
        startMinute: start ? snapshotMinutes(start.start_time) : undefined,
        endMinute: end ? snapshotMinutes(end.end_time) : undefined,
        details: [course.classroom, course.teacher].filter(Boolean)
      }];
    }) : [];
    const events = input.events.flatMap((eventItem): SnapshotScheduleItem[] => {
      if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
      const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
      const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
      const dateRange = eventItem.recurrence_type === "none" && eventItem.end_date > eventItem.start_date;
      const startMinute = snapshotMinutes(eventItem.start_time ?? "00:00");
      const endMinute = snapshotMinutes(eventItem.end_time ?? eventItem.start_time ?? "00:00");
      return [{
        id: `${eventItem.id}-${dateText}`,
        title: eventItem.title,
        time: eventItem.all_day ? "全天" : `${eventItem.start_time?.slice(0, 5) ?? "00:00"}-${eventItem.end_time?.slice(0, 5) ?? eventItem.start_time?.slice(0, 5) ?? "00:00"}`,
        detail: [eventItem.location, category?.name].filter(Boolean).join(" · "),
        color: eventItem.color || category?.color || "#ff6b35",
        completed: completion.completed,
        kind: eventItem.event_type === "habit" ? "habit" : "event",
        allDay: eventItem.all_day,
        startMinute,
        endMinute: Math.max(startMinute + 1, endMinute),
        details: [eventItem.location, category?.name].filter((value): value is string => Boolean(value)),
        continuation: dateRange
          ? `${eventItem.start_date.slice(5).replace("-", "/")}–${eventItem.end_date.slice(5).replace("-", "/")}`
          : undefined
      }];
    });
    const restPeriods = input.periods.filter((period) =>
      !period.deleted_at && period.kind === "break" && period.weekday === (date.getDay() || 7)
      && (!input.semester || period.semester_id === input.semester.id)
      && snapshotMinutes(period.end_time) > snapshotMinutes(period.start_time)
    ).map((period) => ({ name: period.name || "休息", startMinute: snapshotMinutes(period.start_time), endMinute: snapshotMinutes(period.end_time) }));
    return { date, items: [...courses, ...events].sort(compareSnapshotItems), restPeriods };
  });
}

export async function exportScheduleSnapshot(options: {
  mode: "day" | "week";
  days: SnapshotDay[];
  skinId: ThemeSkinId;
  title: string;
  fileName: string;
  template?: SnapshotTemplateConfig;
  layout?: "desktop" | "mobile";
}): Promise<void> {
  const template = options.template ?? SCHEDULE_SNAPSHOT_TEMPLATE;
  const skin = THEME_SKINS.find((item) => item.id === options.skinId) ?? THEME_SKINS[0];
  const rendered = options.mode === "day"
    ? drawDaySnapshot(options.days[0], skin.colors, options.title, template)
    : options.layout === "mobile"
      ? drawMobileWeekSnapshot(options.days, skin.colors, options.title, template)
      : drawWeekSnapshot(options.days, skin.colors, options.title, template);
  const canvas = template.backgroundImageUrl ? await applyTemplateArtwork(rendered, template.backgroundImageUrl) : rendered;
  await exportBlob(await canvasToPngBlob(canvas), `${options.fileName}.png`);
}

async function applyTemplateArtwork(source: HTMLCanvasElement, imageUrl: string): Promise<HTMLCanvasElement> {
  const image = await loadImage(imageUrl);
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  if (!context) return source;
  context.drawImage(source, 0, 0);
  context.save();
  context.globalAlpha = 0.09;
  const scale = Math.max(output.width / image.width, output.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (output.width - width) / 2, (output.height - height) / 2, width, height);
  context.restore();
  return output;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("快照模板背景图加载失败。"));
    image.src = url;
  });
}

function drawDaySnapshot(day: SnapshotDay, colors: [string, string, string], title: string, template: SnapshotTemplateConfig): HTMLCanvasElement {
  const width = 1080;
  const rowHeight = 112;
  const height = Math.max(1280, 330 + Math.max(1, day.items.length) * rowHeight);
  const { canvas, context } = createCanvas(width, height, colors[1]);
  drawHeader(context, width, colors, title, `${day.date.getFullYear()}年${formatMonthDay(day.date)} ${WEEKDAY_LABELS[day.date.getDay()]}`, template);
  let y = 268;
  if (!day.items.length) {
    drawEmpty(context, 64, y, width - 128, 180, colors);
  } else {
    for (const item of day.items) {
      drawItemCard(context, item, 64, y, width - 128, rowHeight - 16, colors, false);
      y += rowHeight;
    }
  }
  drawFooter(context, width, height, colors, template.footerText);
  return canvas;
}

function drawWeekSnapshot(days: SnapshotDay[], colors: [string, string, string], title: string, template: SnapshotTemplateConfig): HTMLCanvasElement {
  const width = 1680;
  const height = 1080;
  const { canvas, context } = createCanvas(width, height, colors[1]);
  const range = days.length ? `${formatMonthDay(days[0].date)} - ${formatMonthDay(days[days.length - 1].date)}` : "";
  drawHeader(context, width, colors, title, range, template);
  const gap = 14;
  const left = 40;
  const columnWidth = (width - left * 2 - gap * 6) / 7;
  days.slice(0, 7).forEach((day, index) => {
    const x = left + index * (columnWidth + gap);
    context.fillStyle = colors[2];
    roundRect(context, x, 250, columnWidth, 748, 14);
    context.fill();
    context.fillStyle = colors[0];
    context.font = "700 26px 'Microsoft YaHei', sans-serif";
    context.fillText(WEEKDAY_LABELS[day.date.getDay()], x + 18, 294);
    context.fillStyle = "#667085";
    context.font = "500 20px 'Microsoft YaHei', sans-serif";
    context.fillText(`${day.date.getMonth() + 1}/${day.date.getDate()}`, x + 18, 328);
    let y = 350;
    const available = 610;
    const itemHeight = day.items.length > 6 ? Math.max(72, Math.floor(available / Math.min(day.items.length, 8))) : 88;
    for (const item of day.items.slice(0, 8)) {
      drawItemCard(context, item, x + 10, y, columnWidth - 20, itemHeight - 8, colors, true);
      y += itemHeight;
    }
    if (day.items.length > 8) {
      context.fillStyle = "#667085";
      context.font = "500 16px 'Microsoft YaHei', sans-serif";
      context.fillText(`另有 ${day.items.length - 8} 项`, x + 18, 976);
    }
  });
  drawFooter(context, width, height, colors, template.footerText);
  return canvas;
}

interface MobileSnapshotTextLine {
  text: string;
  size: number;
  weight: number;
  height: number;
}

interface MobileSnapshotCard {
  item: SnapshotScheduleItem;
  lines: MobileSnapshotTextLine[];
  height: number;
}

interface MobileSnapshotGroup {
  dayIndex: number;
  start: number;
  end: number;
  cards: MobileSnapshotCard[];
  height: number;
}

function drawMobileWeekSnapshot(days: SnapshotDay[], colors: [string, string, string], title: string, template: SnapshotTemplateConfig): HTMLCanvasElement {
  const width = 1080;
  const margin = 24;
  const clockWidth = 0;
  const gap = 8;
  const columnWidth = (width - margin * 2 - clockWidth - gap * 6) / 7;
  const columnX = (index: number) => margin + clockWidth + index * (columnWidth + gap);
  // Measure all content before choosing the canvas height. No mobile items are capped.
  const { canvas, context } = createCanvas(width, 1920, colors[1]);
  const visibleDays = days.slice(0, 7);
  const cardsByDay = visibleDays.map((day) => day.items.map((item) => measureMobileSnapshotCard(context, item, columnWidth)));
  const isUntimed = (card: MobileSnapshotCard) => card.item.allDay || card.item.time === "全天" || card.item.startMinute === undefined || card.item.endMinute === undefined;
  const untimedCards = cardsByDay.map((cards) => cards.filter(isUntimed));
  const allDayHeight = Math.max(0, ...untimedCards.map((cards) => cards.reduce((height, card) => height + card.height + gap, 0)));
  const groups: MobileSnapshotGroup[] = [];
  cardsByDay.forEach((cards, dayIndex) => {
    const timed = cards.filter((card) => !isUntimed(card)).sort((left, right) => left.item.startMinute! - right.item.startMinute! || left.item.endMinute! - right.item.endMinute!);
    let current: MobileSnapshotGroup | undefined;
    for (const card of timed) {
      const start = Math.max(0, Math.min(1439, card.item.startMinute!));
      const end = Math.min(1440, Math.max(start + 1, card.item.endMinute!));
      if (!current || start >= current.end) {
        current = { dayIndex, start, end, cards: [card], height: card.height + gap };
        groups.push(current);
      } else {
        if (current.cards.length === 1) current.height += 28;
        current.cards.push(card);
        current.end = Math.max(current.end, end);
        current.height += card.height + gap;
      }
    }
  });
  const restPeriods = visibleDays.flatMap((day, dayIndex) => (day.restPeriods ?? []).map((rest) => ({ ...rest, dayIndex })));
  const firstMinute = Math.min(480, ...groups.map((group) => group.start), ...restPeriods.map((rest) => rest.startMinute));
  const lastMinute = Math.max(1200, ...groups.map((group) => group.end), ...restPeriods.map((rest) => rest.endMinute));
  const hours = Array.from({ length: Math.floor(lastMinute / 60) - Math.ceil(firstMinute / 60) + 1 }, (_, index) => (Math.ceil(firstMinute / 60) + index) * 60);
  const points = [...new Set([
    firstMinute, lastMinute, ...hours,
    ...groups.flatMap((group) => [group.start, group.end]),
    ...restPeriods.flatMap((rest) => [rest.startMinute, rest.endMinute])
  ])].sort((left, right) => left - right);
  const offsets = new Map<number, number>();
  points.forEach((point, index) => {
    const previous = points[index - 1];
    let offset = index ? offsets.get(previous)! + (point - previous) * 1.8 : 0;
    // A shared, monotonic clock expands crowded intervals for every day together.
    for (const group of groups.filter((item) => item.end === point)) {
      offset = Math.max(offset, offsets.get(group.start)! + group.height);
    }
    for (const rest of restPeriods.filter((item) => item.endMinute === point)) {
      offset = Math.max(offset, offsets.get(rest.startMinute)! + 64);
    }
    offsets.set(point, offset);
  });
  const timelineTop = 250 + (allDayHeight ? allDayHeight + 32 : 0);
  const minimumTimelineHeight = Math.max(720, 1920 - timelineTop - 80);
  const scale = Math.max(1, minimumTimelineHeight / offsets.get(lastMinute)!);
  for (const [minute, offset] of offsets) offsets.set(minute, offset * scale);
  const timelineHeight = offsets.get(lastMinute)!;
  const height = Math.max(1920, Math.ceil(timelineTop + timelineHeight + 80));
  canvas.height = height;
  context.fillStyle = colors[1];
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#243044";
  context.font = "750 40px 'Microsoft YaHei', sans-serif";
  context.fillText(title, margin, 72);
  context.fillStyle = "#5a6678";
  context.font = "500 22px 'Microsoft YaHei', sans-serif";
  context.fillText(`${visibleDays[0]?.date.getFullYear() ?? ""}年`, margin, 112);

  const today = toISODate(new Date());
  visibleDays.forEach((day, dayIndex) => {
    const x = columnX(dayIndex);
    const selected = toISODate(day.date) === today;
    context.fillStyle = selected ? snapshotPastel(colors[0]) : colors[2];
    roundRect(context, x, 144, columnWidth, 82, 18);
    context.fill();
    if (selected) {
      context.strokeStyle = colors[0];
      context.lineWidth = 3;
      context.stroke();
    }
    context.fillStyle = "#243044";
    context.font = `${selected ? 800 : 650} 27px 'Microsoft YaHei', sans-serif`;
    drawCenteredSnapshotText(context, `${day.date.getMonth() + 1}/${day.date.getDate()}`, x, 178, columnWidth);
    context.font = "500 20px 'Microsoft YaHei', sans-serif";
    drawCenteredSnapshotText(context, WEEKDAY_LABELS[day.date.getDay()], x, 208, columnWidth);
  });

  if (allDayHeight) {
    untimedCards.forEach((cards, dayIndex) => {
      let y = 246;
      for (const card of cards) {
        drawMobileSnapshotCard(context, card, columnX(dayIndex), y, columnWidth, card.height, colors);
        y += card.height + gap;
      }
    });
  }

  context.strokeStyle = "#dfe5ed";
  context.lineWidth = 1;
  for (const minute of hours) {
    const y = timelineTop + offsets.get(minute)!;
    context.beginPath();
    context.moveTo(margin + clockWidth, y);
    context.lineTo(width - margin, y);
    context.stroke();
  }

  const drawnRests = new Set<string>();
  for (const rest of restPeriods) {
    const key = `${rest.startMinute}-${rest.endMinute}-${rest.name}`;
    const matching = restPeriods.filter((item) => `${item.startMinute}-${item.endMinute}-${item.name}` === key);
    const common = new Set(matching.map((item) => item.dayIndex)).size === visibleDays.length;
    if (common && drawnRests.has(key)) continue;
    drawnRests.add(key);
    const x = common ? columnX(0) : columnX(rest.dayIndex);
    const restWidth = common ? width - margin - x : columnWidth;
    const top = timelineTop + offsets.get(rest.startMinute)! + 3;
    const restHeight = Math.max(28, offsets.get(rest.endMinute)! - offsets.get(rest.startMinute)! - 6);
    context.fillStyle = colors[2];
    roundRect(context, x, top, restWidth, restHeight, 14);
    context.fill();
    context.fillStyle = "#5a6678";
    context.font = `600 ${common ? 24 : 17}px 'Microsoft YaHei', sans-serif`;
    drawCenteredSnapshotText(context, rest.name, x + 6, top + restHeight / 2 - (common ? 7 : 4), restWidth - 12);
    context.font = `500 ${common ? 18 : 14}px 'Microsoft YaHei', sans-serif`;
    drawCenteredSnapshotText(context, `${snapshotClock(rest.startMinute)}–${snapshotClock(rest.endMinute)}`, x + 6, top + restHeight / 2 + 20, restWidth - 12);
  }

  for (const group of groups) {
    const x = columnX(group.dayIndex);
    let top = timelineTop + offsets.get(group.start)! + 4;
    const groupHeight = offsets.get(group.end)! - offsets.get(group.start)! - 8;
    if (group.cards.length > 1) {
      context.fillStyle = colors[2];
      roundRect(context, x - 2, top - 2, columnWidth + 4, groupHeight + 4, 17);
      context.fill();
      context.fillStyle = "#5a6678";
      context.font = "600 17px 'Microsoft YaHei', sans-serif";
      drawCenteredSnapshotText(context, `重叠 ${group.cards.length} 项`, x, top + 20, columnWidth);
      top += 28;
    }
    group.cards.forEach((card) => {
      const cardHeight = group.cards.length === 1 ? groupHeight : card.height;
      drawMobileSnapshotCard(context, card, x, top, columnWidth, cardHeight, colors);
      top += cardHeight + gap;
    });
  }
  drawFooter(context, width, height, colors, template.brandText);
  return canvas;
}

function measureMobileSnapshotCard(context: CanvasRenderingContext2D, item: SnapshotScheduleItem, width: number): MobileSnapshotCard {
  const lines: MobileSnapshotTextLine[] = [];
  function add(text: string, size: number, weight: number, lineHeight: number) {
    if (!text) return;
    context.font = `${weight} ${size}px 'Microsoft YaHei', sans-serif`;
    for (const line of wrapSnapshotText(context, text, width - 18)) lines.push({ text: line, size, weight, height: lineHeight });
  }
  add(`${item.completed ? "✓ " : ""}${item.title}`, 24, 700, 32);
  const hasTime = item.startMinute !== undefined && item.endMinute !== undefined && !item.allDay && item.time !== "全天";
  add(hasTime ? `${snapshotClock(item.startMinute!)}–${snapshotClock(Math.min(1440, item.endMinute!))}` : item.time, 18, 600, 25);
  for (const detail of item.details ?? (item.detail ? [item.detail] : [])) add(detail, 21, 500, 28);
  if (item.continuation) {
    add("日期范围", 18, 600, 25);
    add(item.continuation, 17, 500, 24);
  }
  return { item, lines, height: Math.max(114, lines.reduce((total, line) => total + line.height, 0) + 30) };
}

function drawMobileSnapshotCard(context: CanvasRenderingContext2D, card: MobileSnapshotCard, x: number, y: number, width: number, height: number, colors: [string, string, string]) {
  context.fillStyle = snapshotPastel(card.item.color || colors[0]);
  roundRect(context, x, y, width, height, 17);
  context.fill();
  const contentHeight = card.lines.reduce((total, line) => total + line.height, 0);
  let lineY = y + Math.max(14, (height - contentHeight) / 2);
  for (const line of card.lines) {
    context.fillStyle = card.item.completed ? "#566172" : "#243044";
    context.font = `${line.weight} ${line.size}px 'Microsoft YaHei', sans-serif`;
    lineY += line.height;
    drawCenteredSnapshotText(context, line.text, x + 9, lineY - 6, width - 18);
  }
}

function wrapSnapshotText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    // Room identifiers such as 33-133 and 45-B404 remain a single token.
    const tokens = paragraph.match(/[A-Za-z0-9]+(?:[-_.:/][A-Za-z0-9]+)*|\s+|[^A-Za-z0-9\s]/g) ?? [];
    let line = "";
    for (const token of tokens) {
      if (line && context.measureText(line + token).width > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else line += token;
    }
    if (line || !tokens.length) lines.push(line.trimEnd());
  }
  return lines;
}

function drawCenteredSnapshotText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number) {
  const textWidth = Math.min(width, context.measureText(text).width);
  context.fillText(text, x + (width - textWidth) / 2, y, width);
}

function snapshotPastel(color: string): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return "#e4eaf5";
  return `#${[0, 2, 4].map((offset) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * 0.3 + 255 * 0.7).toString(16).padStart(2, "0")).join("")}`;
}

function snapshotMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function snapshotClock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function drawHeader(context: CanvasRenderingContext2D, width: number, colors: [string, string, string], title: string, subtitle: string, template: SnapshotTemplateConfig) {
  context.fillStyle = colors[0];
  context.fillRect(0, 0, width, 18);
  context.fillStyle = "#172033";
  context.font = "800 48px 'Microsoft YaHei', sans-serif";
  context.fillText(title, 64, 102);
  context.fillStyle = "#667085";
  context.font = "500 24px 'Microsoft YaHei', sans-serif";
  context.fillText(subtitle, 64, 148);
  context.fillStyle = colors[0];
  context.font = "700 22px 'Microsoft YaHei', sans-serif";
  const brandWidth = context.measureText(template.brandText).width;
  context.fillText(template.brandText, width - 64 - brandWidth, 104);
}

function drawItemCard(context: CanvasRenderingContext2D, item: SnapshotScheduleItem, x: number, y: number, width: number, height: number, colors: [string, string, string], compact: boolean) {
  context.fillStyle = "#ffffff";
  roundRect(context, x, y, width, height, compact ? 10 : 14);
  context.fill();
  context.fillStyle = item.color || colors[0];
  roundRect(context, x, y, compact ? 7 : 9, height, 5);
  context.fill();
  const padding = compact ? 14 : 24;
  context.fillStyle = item.completed ? "#7b8494" : "#172033";
  context.font = `${compact ? 700 : 750} ${compact ? 18 : 26}px 'Microsoft YaHei', sans-serif`;
  drawClippedText(context, `${item.completed ? "✓ " : ""}${item.title}`, x + padding, y + (compact ? 28 : 38), width - padding * 2, compact ? 11 : 20);
  context.fillStyle = "#667085";
  context.font = `500 ${compact ? 14 : 19}px 'Microsoft YaHei', sans-serif`;
  drawClippedText(context, item.time, x + padding, y + (compact ? 53 : 72), width - padding * 2, compact ? 10 : 18);
  if (!compact && item.detail) drawClippedText(context, item.detail, x + padding + 220, y + 72, width - padding * 2 - 220, 18);
}

function drawEmpty(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, colors: [string, string, string]) {
  context.fillStyle = colors[2];
  roundRect(context, x, y, width, height, 14);
  context.fill();
  context.fillStyle = "#667085";
  context.font = "600 26px 'Microsoft YaHei', sans-serif";
  context.fillText("这一天还没有安排", x + 32, y + 96);
}

function drawFooter(context: CanvasRenderingContext2D, width: number, height: number, colors: [string, string, string], text: string) {
  context.fillStyle = colors[0];
  context.globalAlpha = 0.8;
  context.fillRect(0, height - 10, width, 10);
  context.globalAlpha = 1;
  context.fillStyle = "#667085";
  context.font = "500 18px 'Microsoft YaHei', sans-serif";
  const textWidth = context.measureText(text).width;
  context.fillText(text, width - 48 - textWidth, height - 34);
}

function createCanvas(width: number, height: number, background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成快照。");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawClippedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, averageCharacterWidth: number) {
  const limit = Math.max(2, Math.floor(maxWidth / averageCharacterWidth));
  const value = text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
  context.fillText(value, x, y, maxWidth);
}

function compareSnapshotItems(left: SnapshotScheduleItem, right: SnapshotScheduleItem): number {
  const leftTime = left.time === "全天" ? "00:00" : left.time;
  const rightTime = right.time === "全天" ? "00:00" : right.time;
  const time = leftTime.localeCompare(rightTime);
  return time || left.title.localeCompare(right.title, "zh-CN");
}
