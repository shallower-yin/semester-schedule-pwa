import { supabase } from "./supabase";
import type { ScheduleAssistantInput } from "./scheduleAssistant";
import { addDays, courseScheduleOccursOn, eventOccursOn, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { focusDailyTotals } from "./focus";
import type { AnniversaryKind, EventRecurrenceType } from "../types";

export interface DeepSeekAssistantResult {
  answer: string;
  access?: string;
  accessBound?: boolean;
  actions?: DeepSeekAssistantAction[];
}

export type DeepSeekAssistantAction = DeepSeekCreateEventAction | DeepSeekCreateAnniversaryAction | DeepSeekCreateMemoAction;

export interface DeepSeekCreateEventAction {
  type: "create_event";
  eventType?: "event" | "habit";
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
  note?: string | null;
  recurrenceType?: EventRecurrenceType;
  recurrenceUntil?: string | null;
  recurrenceInterval?: number;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

export interface DeepSeekCreateAnniversaryAction {
  type: "create_anniversary";
  title: string;
  kind?: AnniversaryKind;
  date?: string | null;
  note?: string | null;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  reminderTime?: string | null;
}

export interface DeepSeekCreateMemoAction {
  type: "create_memo";
  title: string;
  content?: string | null;
  isPinned?: boolean;
}

export interface DeepSeekAssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildDeepSeekScheduleContext(input: ScheduleAssistantInput) {
  const now = input.now ?? new Date();
  const today = toBeijingISODate(now);
  const beijingToday = new Date(`${today}T00:00:00+08:00`);
  const from = addDays(beijingToday, -7);
  const to = addDays(beijingToday, 14);
  const semester = input.semester;
  const courseMap = new Map(input.courses.filter((course) => !course.deleted_at).map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.filter((category) => !category.deleted_at).map((category) => [category.id, category]));
  return {
    generatedAt: now.toISOString(),
    generatedAtBeijing: now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    today,
    timezone: "Asia/Shanghai",
    appGuide: [
      "AI 助手可以查询日程、检查冲突、查未完成、汇总专注，也可以回答本工具怎么使用。",
      "可以创建普通事项、习惯、纪念日、生日、节日和备忘录。",
      "创建春节、端午节、中秋节、清明节、除夕等常见节日时，按北京时间所在年份或用户指定年份换算公历日期。",
      "学期是可选功能；没有学期也能使用今天、日程、习惯、纪念日、备忘录、专注和设置。",
      "普通事项支持日期、时间、全天、完成状态、重复、地点和提醒。",
      "纪念日、生日、节日支持提前几天和指定时间提醒。",
      "备忘录支持文件夹、置顶、编号和待办清单。"
    ],
    semester: semester ? {
      name: semester.name,
      startDate: semester.start_date,
      totalWeeks: semester.total_weeks
    } : null,
    courses: input.courses.filter((course) => !course.deleted_at).map((course) => ({
      name: course.name,
      teacher: course.teacher,
      classroom: course.classroom,
      note: course.note,
      schedules: input.schedules.filter((schedule) => schedule.course_id === course.id && !schedule.deleted_at).map((schedule) => ({
        weekday: schedule.weekday,
        startPeriod: schedule.start_period,
        endPeriod: schedule.end_period,
        weeks: schedule.weeks
      }))
    })),
    upcomingDays: Array.from({ length: 15 }, (_, index) => addDays(beijingToday, index)).map((date) => {
      const dateText = toISODate(date);
      return {
        date: dateText,
        courses: semester ? input.schedules.flatMap((schedule) => {
          if (schedule.deleted_at || !courseScheduleOccursOn(schedule, semester, date)) return [];
          if (input.cancellations.some((item) => item.course_schedule_id === schedule.id && item.occurrence_date === dateText && !item.deleted_at)) return [];
          const course = courseMap.get(schedule.course_id);
          if (!course) return [];
          return [{
            title: course.name,
            teacher: course.teacher,
            classroom: course.classroom,
            period: `${schedule.start_period}-${schedule.end_period}`
          }];
        }) : [],
        events: input.events.flatMap((eventItem) => {
          if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
          const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
          return [{
            title: eventItem.title,
            type: eventItem.event_type,
            time: eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`,
            category: eventItem.category_id ? categoryMap.get(eventItem.category_id)?.name ?? "未知分类" : "未分类",
            location: eventItem.location ?? "",
            completed: completion.completed,
            note: eventItem.note
          }];
        })
      };
    }),
    recentEvents: input.events.filter((eventItem) => !eventItem.deleted_at && eventItem.end_date >= toISODate(from) && eventItem.start_date <= toISODate(to)).slice(0, 120).map((eventItem) => ({
      title: eventItem.title,
      type: eventItem.event_type,
      startDate: eventItem.start_date,
      endDate: eventItem.end_date,
      time: eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`,
      location: eventItem.location ?? "",
      recurrence: eventItem.recurrence_type,
      recurrenceUntil: eventItem.recurrence_until,
      recurrenceInterval: eventItem.recurrence_interval,
      note: eventItem.note
    })),
    anniversaries: (input.anniversaries ?? []).filter((item) => !item.deleted_at).slice(0, 80).map((item) => ({
      title: item.title,
      kind: item.kind,
      date: item.date,
      reminder: item.reminder_enabled ? `${item.reminder_days_before} 天前 ${item.reminder_time}` : "未提醒",
      note: item.note
    })),
    memos: (input.memos ?? []).filter((item) => !item.deleted_at).slice(0, 60).map((item) => ({
      title: item.title,
      pinned: item.is_pinned,
      preview: item.content.slice(0, 240)
    })),
    focusLast7Days: focusDailyTotals(input.focusSessions, 7, beijingToday)
  };
}

function toBeijingISODate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export async function askDeepSeekAssistant(
  question: string,
  context: unknown,
  accessCode?: string,
  history?: DeepSeekAssistantHistoryMessage[]
): Promise<DeepSeekAssistantResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法使用 AI 助手。");
  const { data, error } = await supabase.functions.invoke<DeepSeekAssistantResult>("ai-assistant", {
    body: {
      question,
      scheduleContext: context,
      accessCode: accessCode || undefined,
      history: history?.slice(-6)
    }
  });
  if (error) {
    throw new Error(await functionErrorMessage(error));
  }
  if (!data?.answer) throw new Error("AI 助手没有返回回答。");
  return data;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "AI 助手请求失败。";
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim()) return text.trim().slice(0, 200);
      } catch {
        // Fall through to the fallback below.
      }
    }
  }
  return fallback.includes("non-2xx") ? "AI 助手请求失败，请稍后再试。" : fallback;
}
