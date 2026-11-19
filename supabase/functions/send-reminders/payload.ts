export interface ReminderRow {
  delivery_id: string;
  source_type?: "event" | "anniversary" | "todo" | "course" | "health";
  source_id?: string;
  event_id?: string | null;
  anniversary_id?: string | null;
  todo_id?: string | null;
  course_schedule_id?: string | null;
  title: string;
  occurrence_date: string;
  start_time: string | null;
  all_day?: boolean | null;
  location?: string | null;
  anniversary_kind?: "anniversary" | "birthday" | "holiday" | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function buildReminderPayload(row: ReminderRow, appUrl: string) {
  function notificationUrl(key: string): string {
    const url = new URL(appUrl);
    url.searchParams.set("notification", key);
    return url.toString();
  }
  const sourceType = row.source_type ?? "event";
  const sourceId = row.source_id ?? row.event_id ?? row.anniversary_id ?? row.todo_id ?? "unknown";
  if (sourceType === "health") {
    return {
      title: "起来活动一下",
      body: "喝口水，活动肩颈或走动几分钟。完成后可在健康页记录。",
      tag: "health-movement-reminder",
      url: appUrl,
      sourceType: "health",
      reminderAt: `${row.occurrence_date}T${String(row.start_time ?? "00:00:00").slice(0, 8)}+08:00`
    };
  }
  if (sourceType === "anniversary") {
    return {
      title: row.title,
      body: `${anniversaryKindLabel(row.anniversary_kind)} · ${row.occurrence_date}`,
      tag: `anniversary-${sourceId}-${row.occurrence_date}`,
      url: notificationUrl(`anniversary:${sourceId}:${row.occurrence_date}`)
    };
  }
  if (sourceType === "todo") {
    return {
      title: row.title || "待办提醒",
      body: formatTodoReminderBody(row),
      tag: `todo-${sourceId}`,
      url: notificationUrl(`todo:${sourceId}`)
    };
  }
  if (sourceType === "course") {
    const key = `course:${sourceId}:${row.course_schedule_id}:${row.occurrence_date}`;
    return {
      title: row.title || "课程提醒",
      body: formatEventReminderBody(row),
      tag: key.replaceAll(":", "-"),
      url: notificationUrl(key)
    };
  }
  return {
    title: row.title,
    body: formatEventReminderBody(row),
    tag: `event-${sourceId}-${row.occurrence_date}`,
    url: notificationUrl(`event:${sourceId}:${row.occurrence_date}`)
  };
}

function formatEventReminderBody(row: ReminderRow): string {
  const timeText = row.all_day || !row.start_time
    ? "全天事项"
    : `${String(row.start_time).slice(0, 5)} 开始`;
  const location = row.location?.trim();
  return location ? `${row.occurrence_date} ${timeText} · ${location}` : `${row.occurrence_date} ${timeText}`;
}

function formatTodoReminderBody(row: ReminderRow): string {
  return `${row.occurrence_date} ${String(row.start_time ?? "00:00").slice(0, 5)} 待办提醒`;
}

function anniversaryKindLabel(kind: ReminderRow["anniversary_kind"]): string {
  if (kind === "birthday") return "生日";
  if (kind === "holiday") return "节日";
  return "纪念日";
}
