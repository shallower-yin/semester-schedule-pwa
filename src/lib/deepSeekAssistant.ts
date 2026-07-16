import { supabase } from "./supabase";
import type { ScheduleAssistantInput } from "./scheduleAssistant";
import { addDays, courseScheduleOccursOn, eventOccursOn, parseLocalDate, startOfWeek, toISODate } from "./date";
import { eventCompletionForDate } from "./eventCompletion";
import { focusDailyTotals } from "./focus";
import type { AnniversaryKind, EventRecurrenceType } from "../types";
import type { AiAssistantAttachment } from "./assistantAttachments";
import { aiModelSupportsAttachments } from "./aiModels";

export interface DeepSeekAssistantResult {
  answer: string;
  access?: string;
  accessBound?: boolean;
  quota?: DeepSeekAssistantQuotaStatus;
  actions?: DeepSeekAssistantAction[];
}

export interface AiAssistantConfiguration {
  provider: "deepseek" | "mimo";
  model: string;
  supportsAttachments: boolean;
}

export interface DeepSeekAssistantQuotaStatus {
  accessMethod: "access-code" | "ordinary" | "member" | "admin";
  accessLabel: string;
  unlimited: boolean;
  usageKnown: boolean;
  currentRequestCounted: boolean;
  daily: { used: number | null; limit: number | null; remaining: number | null };
  weekly: { used: number | null; limit: number | null; remaining: number | null };
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

export interface AiRequestedTimeScope {
  label: string;
  startDate: string;
  endDate: string;
}

export function buildDeepSeekScheduleContext(input: ScheduleAssistantInput, question = "") {
  const now = input.now ?? new Date();
  const today = toBeijingISODate(now);
  const beijingToday = parseLocalDate(today);
  const requestedTimeScope = resolveAiRequestedTimeScope(question, beijingToday);
  const calendarFrom = requestedTimeScope ? parseLocalDate(requestedTimeScope.startDate) : addDays(beijingToday, -7);
  const calendarTo = requestedTimeScope ? parseLocalDate(requestedTimeScope.endDate) : addDays(beijingToday, 14);
  const semester = input.semester;
  const courseMap = new Map(input.courses.filter((course) => !course.deleted_at).map((course) => [course.id, course]));
  const categoryMap = new Map(input.categories.filter((category) => !category.deleted_at).map((category) => [category.id, category]));
  const periodMap = new Map(input.periods.filter((period) => !period.deleted_at && period.kind === "period").map((period) => [`${period.weekday}:${period.period_number}`, period]));
  const calendarDays = Array.from(
    { length: Math.max(1, differenceInDays(calendarTo, calendarFrom) + 1) },
    (_, index) => addDays(calendarFrom, index)
  ).map((date) => {
    const dateText = toISODate(date);
    return {
      date: dateText,
      courses: semester ? input.schedules.flatMap((schedule) => {
        if (schedule.deleted_at || !courseScheduleOccursOn(schedule, semester, date)) return [];
        if (input.cancellations.some((item) => item.course_schedule_id === schedule.id && item.occurrence_date === dateText && !item.deleted_at)) return [];
        const course = courseMap.get(schedule.course_id);
        if (!course) return [];
        const startPeriod = periodMap.get(`${schedule.weekday}:${schedule.start_period}`);
        const endPeriod = periodMap.get(`${schedule.weekday}:${schedule.end_period}`);
        return [{
          title: course.name,
          teacher: course.teacher,
          classroom: course.classroom,
          period: `${schedule.start_period}-${schedule.end_period}`,
          time: startPeriod && endPeriod ? `${startPeriod.start_time}-${endPeriod.end_time}` : ""
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
  });
  return {
    generatedAt: now.toISOString(),
    generatedAtBeijing: now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    today,
    timezone: "Asia/Shanghai",
    requestedTimeScope,
    timeRules: [
      "涉及今天、本周、下周等时间范围时，只能使用 requestedTimeScope 内 calendarDays 中实际发生的记录。",
      "courseTemplates 只是课程重复模板，不能证明某门课在具体日期实际发生。",
      "不得把 requestedTimeScope 之外的课程、事项或习惯加入回答、计划或思维导图。"
    ],
    appGuide: [
      "AI 助手可以查询日程、检查冲突、查未完成、汇总专注，也可以回答本工具怎么使用。",
      "可以创建普通事项、习惯、纪念日、生日、节日和备忘录。",
      "AI 思维导图使用当前管理员选择的 AI 模型，把主题、图片或文档整理成可缩放和导出的树形脑图，每次成功生成会计入一次 AI 额度。",
      "AI 助手不能直接修改、删除或完成已有记录，也不能更改账号、权限、额度或系统设置。",
      "日程助手只在本机按规则查询，不需要 AI 权限且不消耗 AI 额度；AI 助手是云端智能问答，每次成功请求会计入额度。",
      "普通用户和会员分别使用管理员配置的日、周额度，管理员不限额；访问口令只是临时体验。",
      "编辑已发送的用户消息会从该轮重新生成并截断后续旧对话，重新发送会计入一次额度。",
      "创建春节、端午节、中秋节、清明节、除夕等常见节日时，按北京时间所在年份或用户指定年份换算公历日期。",
      "学期是可选功能；没有学期也能使用今天、日程、习惯、纪念日、备忘录、专注和设置。",
      "普通事项支持日期、时间、全天、完成状态、重复、地点和提醒。",
      "事项提醒支持开始时和提前 5、10、15、30 分钟、1 小时、1、3、5、7 天。",
      "重复事项和习惯按每次发生日期分别记录完成状态。",
      "纪念日、生日、节日支持提前几天和指定时间提醒。",
      "备忘录支持文件夹、置顶、编号和待办清单。",
      "数据优先保存在当前设备，登录同一账号后同步；账号同步入口在顶部。",
      "本机自动备份保存在当前浏览器并保留最近 3 份，可从备份弹窗把最近快照下载为 JSON 文件长期保存或跨设备导入。",
      "删除是永久删除，只能通过之前导出的 JSON 备份恢复。"
    ],
    semester: semester ? {
      name: semester.name,
      startDate: semester.start_date,
      totalWeeks: semester.total_weeks
    } : null,
    courseTemplates: requestedTimeScope ? [] : input.courses.filter((course) => !course.deleted_at).map((course) => ({
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
    calendarDays,
    recentEvents: requestedTimeScope ? [] : input.events.filter((eventItem) => !eventItem.deleted_at && eventItem.end_date >= toISODate(calendarFrom) && eventItem.start_date <= toISODate(calendarTo)).slice(0, 120).map((eventItem) => ({
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

export function resolveAiRequestedTimeScope(question: string, today: Date): AiRequestedTimeScope | null {
  const normalized = question.replace(/\s+/g, "");
  if (!normalized) return null;
  const weekdayScope = normalized.match(/(本周|这周|下周)([一二三四五六日天])/);
  if (weekdayScope) {
    const start = addDays(startOfWeek(today), weekdayScope[1] === "下周" ? 7 : 0);
    const weekdayIndex = "一二三四五六日天".indexOf(weekdayScope[2]);
    const date = addDays(start, Math.min(6, weekdayIndex));
    return timeScope(`${weekdayScope[1]}${weekdayScope[2]}`, date, date);
  }
  if (/(本周|这周)/.test(normalized)) {
    const start = startOfWeek(today);
    return timeScope("本周", start, addDays(start, 6));
  }
  if (/下周/.test(normalized)) {
    const start = addDays(startOfWeek(today), 7);
    return timeScope("下周", start, addDays(start, 6));
  }
  if (/后天/.test(normalized)) {
    const date = addDays(today, 2);
    return timeScope("后天", date, date);
  }
  if (/明天/.test(normalized)) {
    const date = addDays(today, 1);
    return timeScope("明天", date, date);
  }
  if (/(今天|今日)/.test(normalized)) return timeScope("今天", today, today);
  const explicitDate = parseRequestedDate(normalized, today);
  if (explicitDate) return timeScope(toISODate(explicitDate), explicitDate, explicitDate);
  if (/下月/.test(normalized)) {
    const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return timeScope("下月", start, end);
  }
  if (/本月/.test(normalized)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return timeScope("本月", start, end);
  }
  return null;
}

function parseRequestedDate(question: string, today: Date): Date | null {
  const full = question.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  const partial = question.match(/(?:^|[^\d])(\d{1,2})[月./-](\d{1,2})日?/);
  const year = full ? Number(full[1]) : today.getFullYear();
  const month = Number(full?.[2] ?? partial?.[1]);
  const day = Number(full?.[3] ?? partial?.[2]);
  if (!month || !day) return null;
  const value = new Date(year, month - 1, day);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) return null;
  return value;
}

function timeScope(label: string, start: Date, end: Date): AiRequestedTimeScope {
  return { label, startDate: toISODate(start), endDate: toISODate(end) };
}

function differenceInDays(left: Date, right: Date): number {
  return Math.round((Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) - Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())) / 86_400_000);
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
  history?: DeepSeekAssistantHistoryMessage[],
  attachments?: AiAssistantAttachment[]
): Promise<DeepSeekAssistantResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法使用 AI 助手。");
  const client = supabase;
  const { data, error } = await invokeFunctionWithTransientRetry(() => client.functions.invoke<DeepSeekAssistantResult>("ai-assistant", {
      body: {
        question,
        scheduleContext: context,
        accessCode: accessCode || undefined,
        history: history?.slice(-6),
        attachments: attachments?.slice(0, 3)
      }
    }), 2);
  if (error) {
    throw new Error(await functionErrorMessage(error));
  }
  if (!data?.answer) throw new Error("AI 助手没有返回回答。");
  return data;
}

export async function getAiAssistantConfiguration(): Promise<AiAssistantConfiguration> {
  if (!supabase) return { provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false };
  const client = supabase;
  const { data, error } = await invokeFunctionWithTransientRetry(() => client.functions.invoke<AiAssistantConfiguration>("ai-assistant", {
      body: { action: "configuration" }
    }), 3);
  if (error || !data) return { provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false };
  return {
    provider: data.provider === "mimo" ? "mimo" : "deepseek",
    model: data.model || (data.provider === "mimo" ? "mimo-v2.5" : "deepseek-v4-flash"),
    supportsAttachments: Boolean(data.supportsAttachments && aiModelSupportsAttachments(data.provider === "mimo" ? "mimo" : "deepseek", data.model))
  };
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
  if (isTransientFunctionError(error)) return "连接 AI 服务时网络不稳定，自动重试后仍未成功，请稍后再试。";
  return fallback.includes("non-2xx") ? "AI 助手请求失败，请稍后再试。" : fallback;
}

async function invokeFunctionWithTransientRetry<T>(
  request: () => Promise<{ data: T | null; error: unknown }>,
  maxAttempts: number
): Promise<{ data: T | null; error: unknown }> {
  let result = await request();
  for (let attempt = 1; attempt < maxAttempts && result.error && isTransientFunctionError(result.error); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    result = await request();
  }
  return result;
}

function isTransientFunctionError(error: unknown): boolean {
  if (!error || (error as { context?: unknown }).context instanceof Response) return false;
  const name = String((error as { name?: unknown }).name ?? "").toLowerCase();
  const message = String((error as { message?: unknown }).message ?? error).toLowerCase();
  return name.includes("fetch")
    || message.includes("failed to send a request")
    || message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("load failed");
}
