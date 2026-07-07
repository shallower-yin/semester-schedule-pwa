import type {
  Category,
  ClassPeriod,
  Course,
  CourseCancellation,
  CourseSchedule,
  EventItem,
  EventOccurrenceState,
  FocusSession,
  Semester
} from "../types";
import { addDays, courseScheduleOccursOn, eventOccursOn, formatMonthDay, parseLocalDate, startOfWeek, toISODate, weekdayOf } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { formatFocusDuration, totalFocusSeconds } from "./focus";
import { buildScheduleOverview, type ScheduleOverviewItem } from "./overview";

export interface ScheduleAssistantInput {
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  cancellations: CourseCancellation[];
  events: EventItem[];
  categories: Category[];
  occurrenceStates: EventOccurrenceState[];
  periods: ClassPeriod[];
  focusSessions: FocusSession[];
  now?: Date;
}

interface AssistantItem {
  type: "course" | "event";
  title: string;
  subtitle: string;
  timeLabel: string;
  sortTime: string;
  completed: boolean;
}

export const SCHEDULE_ASSISTANT_EXAMPLES = [
  "今天有什么安排？",
  "明天有哪些未完成事项？",
  "这周五下午有什么课？",
  "下周一第一节是什么课？",
  "高数在哪个教室？",
  "最近有哪些逾期事项？",
  "这周完成率多少？",
  "最近 7 天专注了多久？",
  "明天有冲突吗？"
];

export function answerScheduleQuestion(question: string, input: ScheduleAssistantInput): string {
  const query = normalizeQuestion(question);
  if (!query) return "可以问我：今天有什么安排、明天有哪些未完成事项、某门课在哪、这周完成率、最近专注多久。";

  if (/(逾期|拖延|过期)/.test(query)) return answerOverdue(input);
  if (/(完成率|完成情况|做完|打卡率)/.test(query)) return answerCompletionRate(input, query);
  if (/(专注|番茄|学习时长)/.test(query)) return answerFocus(input, query);
  if (/(冲突|撞|重叠)/.test(query)) return answerConflicts(input, resolveDate(query, input.now ?? new Date()));
  if (/(教室|在哪|哪里|地点|老师|教师)/.test(query)) return answerCourseLookup(query, input);

  const targetDate = resolveDate(query, input.now ?? new Date());
  const items = itemsForDate(input, targetDate);
  if (/(未完成|没做|未做|待办)/.test(query)) {
    const incomplete = items.filter((item) => item.type === "event" && !item.completed);
    return formatItems(`${dateLabel(targetDate, input.now ?? new Date())}未完成事项`, incomplete, "没有未完成事项。");
  }
  if (/(课程|课|第\d+节|第一节|第二节|第三节|第四节|第五节|第六节|第七节|第八节)/.test(query)) {
    const section = extractPeriodNumber(query);
    const courses = items.filter((item) => item.type === "course" && (!section || item.subtitle.includes(`第${section}节`) || item.timeLabel.includes(`第${section}节`)));
    return formatItems(`${dateLabel(targetDate, input.now ?? new Date())}课程`, courses, "没有课程。");
  }
  const period = extractDayPeriod(query);
  const filtered = period ? items.filter((item) => itemMatchesDayPeriod(item, period)) : items;
  return formatItems(`${dateLabel(targetDate, input.now ?? new Date())}安排`, filtered, "没有安排。");
}

function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, "").replace(/[？?。！!]/g, "");
}

function resolveDate(query: string, now: Date): Date {
  if (query.includes("后天")) return addDays(now, 2);
  if (query.includes("明天")) return addDays(now, 1);
  if (query.includes("昨天")) return addDays(now, -1);

  const week = /(?:(这周|本周|下周)(?:周|星期|礼拜)?|(?:周|星期|礼拜))([一二三四五六日天1-7])/.exec(query);
  if (week) {
    const weekday = weekdayIndex(week[2]);
    if (weekday !== null) return addDays(startOfWeek(now), weekday + (week[1] === "下周" ? 7 : 0));
  }

  const date = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?/.exec(query);
  if (date) return new Date(date[1] ? Number(date[1]) : now.getFullYear(), Number(date[2]) - 1, Number(date[3]));

  return now;
}

function itemsForDate(input: ScheduleAssistantInput, date: Date): AssistantItem[] {
  const targetDate = toISODate(date);
  const courseMap = new Map(input.courses.filter((course) => !course.deleted_at).map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.filter((category) => !category.deleted_at).map((category) => [category.id, category]));
  const courseItems = input.schedules.flatMap((schedule) => {
    if (schedule.deleted_at || !courseScheduleOccursOn(schedule, input.semester, date)) return [];
    if (input.cancellations.some((item) => item.course_schedule_id === schedule.id && item.occurrence_date === targetDate && !item.deleted_at)) return [];
    const course = courseMap.get(schedule.course_id);
    if (!course) return [];
    const startPeriod = input.periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.start_period && !period.deleted_at);
    const endPeriod = input.periods.find((period) => period.weekday === schedule.weekday && period.period_number === schedule.end_period && !period.deleted_at);
    return [{
      type: "course" as const,
      title: course.name,
      subtitle: [course.classroom, course.teacher, `第${schedule.start_period}-${schedule.end_period}节`].filter(Boolean).join(" · "),
      timeLabel: startPeriod && endPeriod ? `${startPeriod.start_time}-${endPeriod.end_time}` : `第${schedule.start_period}-${schedule.end_period}节`,
      sortTime: startPeriod?.start_time ?? "99:99",
      completed: false
    }];
  });

  const eventItems = input.events.flatMap((eventItem) => {
    if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
    const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
    const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
    return [{
      type: "event" as const,
      title: eventItem.title,
      subtitle: [eventItem.event_type === "habit" ? "习惯" : category?.name ?? "事项", completion.completed ? "已完成" : "未完成"].join(" · "),
      timeLabel: eventItem.all_day ? "全天" : formatTimeRange(eventItem.start_time, eventItem.end_time),
      sortTime: eventItem.all_day ? "00:00" : eventItem.start_time ?? "99:99",
      completed: completion.completed
    }];
  });

  return [...courseItems, ...eventItems].sort((left, right) => left.sortTime.localeCompare(right.sortTime) || left.title.localeCompare(right.title, "zh-Hans-CN"));
}

function answerOverdue(input: ScheduleAssistantInput): string {
  const overview = buildScheduleOverview({ ...input, maxItems: 8 }, input.now ?? new Date());
  return formatOverviewItems("最近逾期未完成", overview.overdueIncompleteItems, "最近没有逾期未完成事项。");
}

function answerCompletionRate(input: ScheduleAssistantInput, query: string): string {
  const now = input.now ?? new Date();
  const dates = query.includes("最近7天") || query.includes("近7天")
    ? Array.from({ length: 7 }, (_, index) => addDays(now, index - 6))
    : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(now), index)).filter((date) => date <= now);
  const completions = dates.flatMap((date) =>
    input.events.flatMap((eventItem) => eventItem.deleted_at || !eventOccursOn(eventItem, date) ? [] : [eventCompletionForDate(eventItem, input.occurrenceStates, date)])
  );
  const completed = completions.filter((item) => item.completed).length;
  const rate = completions.length ? Math.round((completed / completions.length) * 100) : 0;
  return `这段时间共有 ${completions.length} 个事项/习惯出现，已完成 ${completed} 个，完成率 ${rate}%。`;
}

function answerFocus(input: ScheduleAssistantInput, query: string): string {
  const now = input.now ?? new Date();
  const from = query.includes("今天") ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : addDays(now, -6);
  const sessions = input.focusSessions.filter((session) => !session.deleted_at && new Date(session.ended_at) >= from && new Date(session.ended_at) <= now);
  return `${query.includes("今天") ? "今天" : "最近 7 天"}专注 ${formatFocusDuration(totalFocusSeconds(sessions))}，共 ${sessions.length} 次记录。`;
}

function answerConflicts(input: ScheduleAssistantInput, date: Date): string {
  const items = itemsForDate(input, date);
  const conflicts: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
      if (itemsOverlap(items[index], items[nextIndex])) conflicts.push(`${items[index].title} 与 ${items[nextIndex].title}（${items[index].timeLabel} / ${items[nextIndex].timeLabel}）`);
    }
  }
  return conflicts.length
    ? `${dateLabel(date, input.now ?? new Date())}发现 ${conflicts.length} 个可能冲突：\n${conflicts.slice(0, 6).map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : `${dateLabel(date, input.now ?? new Date())}没有发现明显时间冲突。`;
}

function answerCourseLookup(query: string, input: ScheduleAssistantInput): string {
  const matched = input.courses.filter((course) => !course.deleted_at && query.includes(course.name.replace(/\s+/g, "")));
  if (!matched.length) return "没有找到匹配课程。可以直接问“高数在哪个教室”或“英语老师是谁”。";
  return matched.map((course) => {
    const schedules = input.schedules.filter((schedule) => schedule.course_id === course.id && !schedule.deleted_at);
    const timeText = schedules.slice(0, 3).map((schedule) => `周${schedule.weekday} 第${schedule.start_period}-${schedule.end_period}节`).join("；") || "暂无上课安排";
    return `${course.name}：教室 ${course.classroom || "未填写"}，教师 ${course.teacher || "未填写"}，${timeText}。`;
  }).join("\n");
}

function formatItems(title: string, items: AssistantItem[], empty: string): string {
  if (!items.length) return `${title}：${empty}`;
  return `${title}：\n${items.slice(0, 8).map((item, index) => `${index + 1}. ${item.timeLabel} ${item.title}（${item.subtitle}）`).join("\n")}`;
}

function formatOverviewItems(title: string, items: ScheduleOverviewItem[], empty: string): string {
  if (!items.length) return `${title}：${empty}`;
  return `${title}：\n${items.slice(0, 8).map((item, index) => `${index + 1}. ${item.timeLabel} ${item.title}（${item.subtitle}）`).join("\n")}`;
}

function dateLabel(date: Date, now: Date): string {
  const target = toISODate(date);
  if (target === toISODate(now)) return "今天";
  if (target === toISODate(addDays(now, 1))) return "明天";
  if (target === toISODate(addDays(now, 2))) return "后天";
  return formatMonthDay(date);
}

function extractDayPeriod(query: string): "morning" | "afternoon" | "evening" | null {
  if (/(上午|早上|上午课)/.test(query)) return "morning";
  if (/(下午|午后)/.test(query)) return "afternoon";
  if (/(晚上|晚间|今晚)/.test(query)) return "evening";
  return null;
}

function itemMatchesDayPeriod(item: AssistantItem, period: "morning" | "afternoon" | "evening"): boolean {
  const start = minutesOf(item.sortTime);
  if (period === "morning") return start < 12 * 60;
  if (period === "afternoon") return start >= 12 * 60 && start < 18 * 60;
  return start >= 18 * 60;
}

function extractPeriodNumber(query: string): number | null {
  const chinese = new Map([["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10]]);
  const text = /第([一二三四五六七八九十\d]+)节/.exec(query)?.[1];
  if (!text) return null;
  return Number(text) || chinese.get(text) || null;
}

function weekdayIndex(value: string): number | null {
  return { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6 }[value] ?? null;
}

function itemsOverlap(left: AssistantItem, right: AssistantItem): boolean {
  if (left.timeLabel === "全天" || right.timeLabel === "全天") return true;
  const leftStart = minutesOf(left.sortTime);
  const leftEnd = minutesOf(left.timeLabel.split("-")[1] ?? left.sortTime);
  const rightStart = minutesOf(right.sortTime);
  const rightEnd = minutesOf(right.timeLabel.split("-")[1] ?? right.sortTime);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function minutesOf(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 99 * 60;
  return hour * 60 + minute;
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  if (end) return end;
  return "未设置时间";
}
