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
import { THEME_SKINS, type ThemeSkinId } from "./themeSkins";

export interface SnapshotScheduleItem {
  id: string;
  title: string;
  time: string;
  detail: string;
  color: string;
  completed: boolean;
  kind: "course" | "event" | "habit";
}

export interface SnapshotDay {
  date: Date;
  items: SnapshotScheduleItem[];
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
        kind: "course"
      }];
    }) : [];
    const events = input.events.flatMap((eventItem): SnapshotScheduleItem[] => {
      if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
      const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
      const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
      return [{
        id: `${eventItem.id}-${dateText}`,
        title: eventItem.title,
        time: eventItem.all_day ? "全天" : `${eventItem.start_time?.slice(0, 5) ?? "00:00"}-${eventItem.end_time?.slice(0, 5) ?? eventItem.start_time?.slice(0, 5) ?? "00:00"}`,
        detail: [eventItem.location, category?.name].filter(Boolean).join(" · "),
        color: eventItem.color || category?.color || "#ff6b35",
        completed: completion.completed,
        kind: eventItem.event_type === "habit" ? "habit" : "event"
      }];
    });
    return { date, items: [...courses, ...events].sort(compareSnapshotItems) };
  });
}

export async function exportScheduleSnapshot(options: {
  mode: "day" | "week";
  days: SnapshotDay[];
  skinId: ThemeSkinId;
  title: string;
  fileName: string;
  template?: SnapshotTemplateConfig;
}): Promise<void> {
  const template = options.template ?? SCHEDULE_SNAPSHOT_TEMPLATE;
  const skin = THEME_SKINS.find((item) => item.id === options.skinId) ?? THEME_SKINS[0];
  const rendered = options.mode === "day"
    ? drawDaySnapshot(options.days[0], skin.colors, options.title, template)
    : drawWeekSnapshot(options.days, skin.colors, options.title, template);
  const canvas = template.backgroundImageUrl ? await applyTemplateArtwork(rendered, template.backgroundImageUrl) : rendered;
  const link = document.createElement("a");
  link.download = `${options.fileName}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
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
