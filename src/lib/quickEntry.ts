import { addDays, startOfWeek, toISODate } from "./date";

export interface QuickEntryDraft {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
}

const WEEKDAY_ALIASES = new Map<string, number>([
  ["一", 0],
  ["二", 1],
  ["三", 2],
  ["四", 3],
  ["五", 4],
  ["六", 5],
  ["日", 6],
  ["天", 6],
  ["1", 0],
  ["2", 1],
  ["3", 2],
  ["4", 3],
  ["5", 4],
  ["6", 5],
  ["7", 6]
]);

export const QUICK_ENTRY_EXAMPLES = [
  "今天 18点30 写实验报告",
  "明天 9:00 交作业",
  "后天 20点 背单词",
  "这周五 14:30 开组会",
  "下周一 8点10 上机测试",
  "7月18日 19:00 看电影"
];

export function parseQuickEntry(input: string, now = new Date()): QuickEntryDraft | null {
  let text = input.trim().replace(/\s+/g, " ");
  if (!text) return null;

  const dateResult = consumeDate(text, now);
  if (!dateResult) return null;
  text = dateResult.rest.trim();

  const timeResult = consumeTime(text);
  if (!timeResult) return null;
  text = timeResult.rest.trim();

  const title = text.replace(/^[:：,，。.\s]+/, "").trim();
  if (!title) return null;

  return {
    title,
    date: toISODate(dateResult.date),
    startTime: timeResult.startTime,
    endTime: addMinutes(timeResult.startTime, 60)
  };
}

function consumeDate(text: string, now: Date): { date: Date; rest: string } | null {
  const relative = /^(今天|明天|后天)(?:\s+|，|,|。|$)/.exec(text);
  if (relative) {
    const offset = relative[1] === "今天" ? 0 : relative[1] === "明天" ? 1 : 2;
    return { date: addDays(now, offset), rest: text.slice(relative[0].length) };
  }

  const week = /^(?:(这周|本周|下周)(?:周|星期|礼拜)?|(?:周|星期|礼拜))([一二三四五六日天1-7])(?:\s+|，|,|。|$)/.exec(text);
  if (week) {
    const weekday = WEEKDAY_ALIASES.get(week[2]);
    if (weekday === undefined) return null;
    const offset = week[1] === "下周" ? 7 : 0;
    return { date: addDays(startOfWeek(now), weekday + offset), rest: text.slice(week[0].length) };
  }

  const chineseDate = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?(?:\s+|，|,|。|$)/.exec(text);
  if (chineseDate) {
    const year = chineseDate[1] ? Number(chineseDate[1]) : now.getFullYear();
    return { date: new Date(year, Number(chineseDate[2]) - 1, Number(chineseDate[3])), rest: text.slice(chineseDate[0].length) };
  }

  const slashDate = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?:\s+|，|,|。|$)/.exec(text);
  if (slashDate) {
    const year = slashDate[1] ? Number(slashDate[1]) : now.getFullYear();
    return { date: new Date(year, Number(slashDate[2]) - 1, Number(slashDate[3])), rest: text.slice(slashDate[0].length) };
  }

  return null;
}

function consumeTime(text: string): { startTime: string; rest: string } | null {
  const result = /^(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})(?::|点|時|时)(\d{1,2})?(?:分)?(?:\s+|，|,|。|$)/.exec(text);
  if (!result) return null;
  let hour = Number(result[2]);
  const minute = Number(result[3] ?? 0);
  const period = result[1] ?? "";
  if ((period === "下午" || period === "晚上" || period === "今晚") && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return {
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    rest: text.slice(result[0].length)
  };
}

function addMinutes(time: string, amount: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + amount;
  const next = Math.min(23 * 60 + 59, Math.max(0, total));
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}
