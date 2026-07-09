export type ISODate = string;
export type ISODateTime = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PageId = "today" | "calendar" | "habits" | "anniversaries" | "memos" | "focus" | "settings" | "help";

export interface SyncFields {
  id: string;
  user_id: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null;
  version: number;
  device_id: string;
}

export interface Semester extends SyncFields {
  name: string;
  start_date: ISODate;
  total_weeks: number;
  is_current: boolean;
}

export interface ClassPeriod extends SyncFields {
  semester_id: string;
  weekday: Weekday;
  period_number: number;
  kind: "period" | "break";
  sort_order: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface Course extends SyncFields {
  semester_id: string;
  name: string;
  teacher: string;
  classroom: string;
  color: string;
  note: string;
}

export interface CourseSchedule extends SyncFields {
  course_id: string;
  weekday: Weekday;
  start_period: number;
  end_period: number;
  weeks: number[];
}

export interface CourseCancellation extends SyncFields {
  course_schedule_id: string;
  occurrence_date: ISODate;
  reason: string;
}

export interface Category extends SyncFields {
  name: string;
  color: string;
  icon: string;
}

export type EventType = "event" | "habit";
export type EventRecurrenceType = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "interval";

export interface EventItem extends SyncFields {
  event_type: EventType;
  title: string;
  start_date: ISODate;
  start_time: string | null;
  end_date: ISODate;
  end_time: string | null;
  all_day: boolean;
  category_id: string | null;
  color: string;
  note: string;
  recurrence_type: EventRecurrenceType;
  recurrence_until: ISODate | null;
  recurrence_interval: number;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  timezone: string;
}

export interface EventOccurrenceState extends SyncFields {
  event_id: string;
  occurrence_date: ISODate;
  completed: boolean;
  reminder_sent_at: ISODateTime | null;
}

export type AnniversaryKind = "anniversary" | "birthday" | "holiday";

export interface Anniversary extends SyncFields {
  kind: AnniversaryKind;
  title: string;
  date: ISODate;
  color: string;
  note: string;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_sent_for: ISODate | null;
  timezone: string;
}

export interface MemoFolder extends SyncFields {
  name: string;
  sort_order: number;
}

export interface Memo extends SyncFields {
  folder_id: string | null;
  title: string;
  content: string;
  is_pinned: boolean;
}

export type FocusMode = "stopwatch" | "countdown" | "pomodoro" | "lock";

export interface FocusSettings extends SyncFields {
  pomodoro_minutes: number;
  short_break_minutes: number;
  countdown_minutes: number;
  daily_goal_minutes: number;
  sound_enabled: boolean;
}

export interface FocusSession extends SyncFields {
  mode: FocusMode;
  task_title: string;
  linked_event_id: string | null;
  planned_seconds: number | null;
  duration_seconds: number;
  started_at: ISODateTime;
  ended_at: ISODateTime;
  completed: boolean;
  interrupted: boolean;
}

export interface SyncQueueItem {
  id: string;
  table_name: SyncTableName;
  record_id: string;
  operation: "upsert" | "delete";
  queued_at: ISODateTime;
  attempts: number;
  last_error: string | null;
}

export type SyncTableName =
  | "semesters"
  | "classPeriods"
  | "courses"
  | "courseSchedules"
  | "courseCancellations"
  | "categories"
  | "events"
  | "eventOccurrenceStates"
  | "anniversaries"
  | "memoFolders"
  | "memos"
  | "focusSettings"
  | "focusSessions";

export interface BackupFile {
  format: "semester-schedule-backup";
  schema_version: 1;
  exported_at: ISODateTime;
  data: Record<SyncTableName, unknown[]>;
}

export interface LocalBackupSnapshot {
  id: string;
  created_at: ISODateTime;
  reason: "scheduled" | "manual";
  record_count: number;
  backup: BackupFile;
}
