export type ISODate = string;
export type ISODateTime = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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

export interface EventItem extends SyncFields {
  title: string;
  start_date: ISODate;
  start_time: string | null;
  end_date: ISODate;
  end_time: string | null;
  all_day: boolean;
  category_id: string | null;
  color: string;
  note: string;
  recurrence_type: "none" | "weekly";
  recurrence_until: ISODate | null;
}

export interface EventOccurrenceState extends SyncFields {
  event_id: string;
  occurrence_date: ISODate;
  completed: boolean;
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
  | "eventOccurrenceStates";

export interface BackupFile {
  format: "semester-schedule-backup";
  schema_version: 1;
  exported_at: ISODateTime;
  data: Record<SyncTableName, unknown[]>;
}
