import type { Weekday } from "../types";

export const WEEKDAY_NAMES = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
export const WEEKDAY_SHORT_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

export interface VisualTimeRow {
  key: string;
  periodNumber: number;
  name: string;
  startTime: string;
  endTime: string;
  kind: "period" | "break";
}

export const DEFAULT_TIME_ROWS: VisualTimeRow[] = [
  { key: "p1", periodNumber: 1, name: "第一节", startTime: "08:30", endTime: "09:15", kind: "period" },
  { key: "p2", periodNumber: 2, name: "第二节", startTime: "09:20", endTime: "10:05", kind: "period" },
  { key: "p3", periodNumber: 3, name: "第三节", startTime: "10:25", endTime: "11:10", kind: "period" },
  { key: "p4", periodNumber: 4, name: "第四节", startTime: "11:15", endTime: "12:00", kind: "period" },
  { key: "lunch", periodNumber: 0, name: "午休", startTime: "12:00", endTime: "13:30", kind: "break" },
  { key: "p5", periodNumber: 5, name: "第五节", startTime: "13:30", endTime: "14:15", kind: "period" },
  { key: "p6", periodNumber: 6, name: "第六节", startTime: "14:20", endTime: "15:05", kind: "period" },
  { key: "p7", periodNumber: 7, name: "第七节", startTime: "15:25", endTime: "16:10", kind: "period" },
  { key: "p8", periodNumber: 8, name: "第八节", startTime: "16:15", endTime: "17:00", kind: "period" },
  { key: "p9", periodNumber: 9, name: "第九节", startTime: "18:30", endTime: "19:15", kind: "period" },
  { key: "p10", periodNumber: 10, name: "第十节", startTime: "19:20", endTime: "20:05", kind: "period" },
  { key: "p11", periodNumber: 11, name: "第十一节", startTime: "20:10", endTime: "20:55", kind: "period" },
  { key: "p12", periodNumber: 12, name: "第十二节", startTime: "21:00", endTime: "21:45", kind: "period" }
];

export const DEFAULT_CATEGORIES = [
  { name: "学习", color: "#4f6bdc", icon: "book-open" },
  { name: "生活", color: "#22a06b", icon: "coffee" },
  { name: "会议", color: "#8b5cf6", icon: "users" },
  { name: "提醒", color: "#e36b32", icon: "bell" }
];

export function defaultPeriodsForWeekday(weekday: Weekday) {
  return DEFAULT_TIME_ROWS.map((row, index) => ({
    weekday,
    period_number: row.periodNumber,
    kind: row.kind,
    sort_order: index + 1,
    name: row.name,
    start_time: row.startTime,
    end_time: row.endTime
  }));
}
