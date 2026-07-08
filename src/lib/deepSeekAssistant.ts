import { supabase } from "./supabase";
import type { ScheduleAssistantInput } from "./scheduleAssistant";
import { addDays, courseScheduleOccursOn, eventOccursOn, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { focusDailyTotals } from "./focus";

export interface DeepSeekAssistantResult {
  answer: string;
  access?: string;
  accessBound?: boolean;
  actions?: DeepSeekAssistantAction[];
}

export interface DeepSeekAssistantAction {
  type: "create_event";
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  note?: string | null;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

export function buildDeepSeekScheduleContext(input: ScheduleAssistantInput) {
  const now = input.now ?? new Date();
  const from = addDays(now, -7);
  const to = addDays(now, 14);
  const courseMap = new Map(input.courses.filter((course) => !course.deleted_at).map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.filter((category) => !category.deleted_at).map((category) => [category.id, category]));
  return {
    generatedAt: new Date().toISOString(),
    today: toISODate(now),
    semester: {
      name: input.semester.name,
      startDate: input.semester.start_date,
      totalWeeks: input.semester.total_weeks
    },
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
    upcomingDays: Array.from({ length: 15 }, (_, index) => addDays(now, index)).map((date) => {
      const dateText = toISODate(date);
      return {
        date: dateText,
        courses: input.schedules.flatMap((schedule) => {
          if (schedule.deleted_at || !courseScheduleOccursOn(schedule, input.semester, date)) return [];
          if (input.cancellations.some((item) => item.course_schedule_id === schedule.id && item.occurrence_date === dateText && !item.deleted_at)) return [];
          const course = courseMap.get(schedule.course_id);
          if (!course) return [];
          return [{
            title: course.name,
            teacher: course.teacher,
            classroom: course.classroom,
            period: `${schedule.start_period}-${schedule.end_period}`
          }];
        }),
        events: input.events.flatMap((eventItem) => {
          if (eventItem.deleted_at || !eventOccursOn(eventItem, date)) return [];
          const completion = eventCompletionForDate(eventItem, input.occurrenceStates, date);
          return [{
            title: eventItem.title,
            type: eventItem.event_type,
            time: eventItem.all_day ? "全天" : `${eventItem.start_time ?? ""}-${eventItem.end_time ?? ""}`,
            category: eventItem.category_id ? categoryMap.get(eventItem.category_id)?.name ?? "未知分类" : "未分类",
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
      recurrence: eventItem.recurrence_type,
      note: eventItem.note
    })),
    focusLast7Days: focusDailyTotals(input.focusSessions, 7, now)
  };
}

export async function askDeepSeekAssistant(question: string, context: unknown, accessCode?: string): Promise<DeepSeekAssistantResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法使用 AI 助手。");
  const { data, error } = await supabase.functions.invoke<DeepSeekAssistantResult>("ai-assistant", {
    body: { question, scheduleContext: context, accessCode: accessCode || undefined }
  });
  if (error) throw new Error(error.message || "AI 助手请求失败。");
  if (!data?.answer) throw new Error("AI 助手没有返回回答。");
  return data;
}
