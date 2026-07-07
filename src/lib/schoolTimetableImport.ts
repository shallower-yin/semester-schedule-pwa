import type { Weekday } from "../types";

export const TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR = "天津大学课表提取器";

export interface ImportedClassPeriod {
  periodNumber: number;
  name: string;
  startTime: string;
  endTime: string;
}

export interface ImportedCourseSchedule {
  name: string;
  teacher: string;
  classroom: string;
  weekday: Weekday;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  rawText: string;
  sourceTaskId?: string;
  sourceRoomId?: string;
}

export interface ImportedTimetable {
  extractorName: typeof TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR;
  termName: string | null;
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  totalCredits: string | null;
  periods: ImportedClassPeriod[];
  schedules: ImportedCourseSchedule[];
  warnings: string[];
  sourceName?: string;
  isFrameFile: boolean;
  parseMode: "task-activity" | "html-table" | "none";
}

interface GridEntry {
  cell: HTMLTableCellElement;
  anchorRow: number;
  anchorCol: number;
  rowSpan: number;
  colSpan: number;
}

interface ParsedTeacher {
  id: number;
  name: string;
  lab: boolean;
}

interface TaskIndexRange {
  weekday: Weekday;
  startPeriod: number;
  endPeriod: number;
}

const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;

const COURSE_COLORS = [
  "#5b78df",
  "#22a06b",
  "#e36b32",
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
  "#14b8a6",
  "#ef4444"
];

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

export function colorForImportedCourse(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COURSE_COLORS[hash % COURSE_COLORS.length];
}

export async function parseSchoolTimetableFiles(fileList: FileList | File[]): Promise<ImportedTimetable> {
  const files = Array.from(fileList);
  if (!files.length) throw new Error("请选择学校导出的课表文件。");

  const parsed: ImportedTimetable[] = [];
  const frameFileNames: string[] = [];
  const fileNames = files.map((file) => file.name).join("、");

  for (const file of files) {
    const html = decodeTimetableText(await file.arrayBuffer());
    const timetable = parseSchoolTimetableHtml(html, file.name);
    if (timetable.schedules.length > 0) {
      parsed.push(timetable);
    } else if (timetable.isFrameFile) {
      frameFileNames.push(file.name);
    }
  }

  if (!parsed.length) {
    const frameHint = frameFileNames.length
      ? `已选择 ${frameFileNames.join("、")}，但它只是外层框架文件。请同时选择“课表 .files”文件夹里的 sheet001.htm，或直接选择这个 htm 文件。`
      : "没有在所选文件中找到“节次/周次”和星期一至星期日的课表表格。";
    throw new Error(frameHint);
  }

  const best = parsed.sort((left, right) => right.schedules.length - left.schedules.length)[0];
  return {
    ...best,
    warnings: [
      ...best.warnings,
      ...(parsed.length > 1 ? [`已从 ${fileNames} 中选择课程最多的文件：${best.sourceName ?? "未命名文件"}。`] : [])
    ]
  };
}

export function parseSchoolTimetableHtml(html: string, sourceName?: string): ImportedTimetable {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const bodyText = normalizeText(document.body?.textContent ?? "");
  const isFrameFile = /Excel Workbook Frameset/i.test(html) || document.querySelectorAll("frame").length > 0;
  const termName = bodyText.match(/\d{4}\s*-\s*\d{4}\s*学年\s*第[一二三四五六七八九十]+学期/)?.[0].replace(/\s+/g, "") ?? null;
  const metadata = parseStudentMetadata(bodyText);
  const rows = Array.from(document.querySelectorAll("tr"));
  const grid = buildGrid(rows);
  const headerRowIndex = grid.findIndex((row) => {
    const joined = row.map((entry) => cellText(entry.cell)).join(" ");
    return joined.includes("节次/周次") && WEEKDAY_LABELS.every((label) => joined.includes(label));
  });
  const periods = headerRowIndex >= 0 ? extractPeriods(grid, headerRowIndex) : [];
  const taskSchedules = parseTaskActivitySchedules(html);

  if (taskSchedules.length > 0) {
    const warnings: string[] = [];
    if (!periods.length) warnings.push("已提取课程安排，但未识别到节次时间；导入时会沿用当前学期已有节次。");
    return {
      extractorName: TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR,
      termName,
      ...metadata,
      periods,
      schedules: taskSchedules,
      warnings,
      sourceName,
      isFrameFile,
      parseMode: "task-activity"
    };
  }

  if (headerRowIndex < 0) {
    return {
      extractorName: TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR,
      termName,
      ...metadata,
      periods: [],
      schedules: [],
      warnings: isFrameFile ? ["这是外层 Excel 框架文件，真正课表通常在同名 .files 文件夹的 sheet001.htm 中。"] : [],
      sourceName,
      isFrameFile,
      parseMode: "none"
    };
  }

  const warnings: string[] = [];
  const dayColumns = weekdayColumns(grid[headerRowIndex]);
  if (Object.keys(dayColumns).length < 7) warnings.push("未完整识别星期一至星期日列，导入前请核对预览。");

  const schedules: ImportedCourseSchedule[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const period = parsePeriodLabel(row?.[0]?.cell ? cellText(row[0].cell) : "");
    if (!period) continue;

    for (const [weekdayValue, colIndex] of Object.entries(dayColumns)) {
      const weekday = Number(weekdayValue) as Weekday;
      const entry = row?.[colIndex];
      if (!entry || entry.anchorRow !== rowIndex || entry.anchorCol !== colIndex) continue;
      const raw = (entry.cell.getAttribute("title") || cellHtmlText(entry.cell)).trim();
      if (!raw || !raw.includes("周")) continue;
      const parsedSchedules = parseScheduleCell(raw);
      for (const item of parsedSchedules) {
        schedules.push({
          ...item,
          weekday,
          startPeriod: period.periodNumber,
          endPeriod: period.periodNumber + entry.rowSpan - 1,
          rawText: raw
        });
      }
    }
  }

  const schedulesWithoutWeeks = schedules.filter((schedule) => schedule.weeks.length === 0);
  if (schedulesWithoutWeeks.length) {
    warnings.push(`有 ${schedulesWithoutWeeks.length} 条课程未识别出周数，已跳过。`);
  }

  return {
    extractorName: TIANJIN_UNIVERSITY_TIMETABLE_EXTRACTOR,
    termName,
    ...metadata,
    periods: periods.sort((left, right) => left.periodNumber - right.periodNumber),
    schedules: schedules.filter((schedule) => schedule.weeks.length > 0),
    warnings,
    sourceName,
    isFrameFile,
    parseMode: "html-table"
  };
}

function parseStudentMetadata(bodyText: string): Pick<ImportedTimetable, "studentId" | "studentName" | "className" | "totalCredits"> {
  const match = bodyText.match(/学号\s*:\s*(\S+)\s+学生姓名\s*:\s*([^\s]+)\s+所属班级\s*:\s*(.*?)\s+总学分\s*:\s*([\d.]+)/);
  return {
    studentId: match?.[1] ?? null,
    studentName: match?.[2] ?? null,
    className: match?.[3]?.trim() || null,
    totalCredits: match?.[4] ?? null
  };
}

function extractPeriods(grid: GridEntry[][], headerRowIndex: number): ImportedClassPeriod[] {
  const seen = new Map<number, ImportedClassPeriod>();
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const period = parsePeriodLabel(row?.[0]?.cell ? cellText(row[0].cell) : "");
    if (period && !seen.has(period.periodNumber)) seen.set(period.periodNumber, period);
  }
  return Array.from(seen.values()).sort((left, right) => left.periodNumber - right.periodNumber);
}

function parseTaskActivitySchedules(html: string): ImportedCourseSchedule[] {
  const taskPattern =
    /var\s+teachers\s*=\s*(\[[\s\S]*?\]);\s*var\s+actTeachers\s*=\s*(\[[\s\S]*?\]);[\s\S]*?activity\s*=\s*new\s+TaskActivity\(\s*actTeacherId\.join\(','\)\s*,\s*actTeacherName\.join\(','\)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"[\s\S]*?\);\s*([\s\S]*?)(?=var\s+teachers\s*=|<\/script>)/g;
  const schedules: ImportedCourseSchedule[] = [];

  for (const match of html.matchAll(taskPattern)) {
    const teachers = parseTeacherArray(match[1]);
    const actTeachers = parseTeacherArray(match[2]);
    const taskTeachers = resolveTaskTeachers(teachers, actTeachers);
    const teacher = taskTeachers.map((item) => item.name).join(",");
    const sourceTaskId = decodeJsString(match[3]);
    const name = decodeJsString(match[4]);
    const sourceRoomId = decodeJsString(match[5]);
    const classroom = decodeJsString(match[6]);
    const weeks = weekMaskToWeeks(decodeJsString(match[7]));
    const ranges = parseTaskIndexRanges(match[8]);

    for (const range of ranges) {
      schedules.push({
        name,
        teacher,
        classroom,
        weekday: range.weekday,
        startPeriod: range.startPeriod,
        endPeriod: range.endPeriod,
        weeks,
        rawText: `${name}${teacher ? ` (${teacher})` : ""} (${formatWeekSummary(weeks)} 周${classroom ? `,${classroom}` : ""})`,
        sourceTaskId,
        sourceRoomId
      });
    }
  }

  return schedules.filter((schedule) => schedule.weeks.length > 0);
}

function parseTeacherArray(arrayText: string): ParsedTeacher[] {
  const result: ParsedTeacher[] = [];
  const teacherPattern = /\{\s*id\s*:\s*(\d+)\s*,\s*name\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*lab\s*:\s*(true|false)\s*\}/g;
  for (const match of arrayText.matchAll(teacherPattern)) {
    result.push({
      id: Number(match[1]),
      name: decodeJsString(match[2]),
      lab: match[3] === "true"
    });
  }
  return result;
}

function resolveTaskTeachers(teachers: ParsedTeacher[], actTeachers: ParsedTeacher[]): ParsedTeacher[] {
  if (!actTeachers.length) return teachers;
  const assistantIds = new Set(
    actTeachers
      .filter((actTeacher) => actTeacher.lab && !teachers.some((teacher) => sameTeacher(teacher, actTeacher)))
      .map((teacher) => teacher.id)
  );
  return actTeachers.filter((teacher) => !assistantIds.has(teacher.id));
}

function sameTeacher(left: ParsedTeacher, right: ParsedTeacher): boolean {
  return left.id === right.id && left.name === right.name && left.lab === right.lab;
}

function parseTaskIndexRanges(indexBlock: string): TaskIndexRange[] {
  const byDay = new Map<number, Set<number>>();
  const indexPattern = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g;
  for (const match of indexBlock.matchAll(indexPattern)) {
    const dayIndex = Number(match[1]);
    const slotIndex = Number(match[2]);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;
    if (!Number.isInteger(slotIndex) || slotIndex < 0) continue;
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, new Set());
    byDay.get(dayIndex)!.add(slotIndex);
  }

  const ranges: TaskIndexRange[] = [];
  for (const [dayIndex, slotSet] of byDay.entries()) {
    const slots = Array.from(slotSet).sort((left, right) => left - right);
    let rangeStart: number | null = null;
    let previous: number | null = null;
    const flush = () => {
      if (rangeStart === null || previous === null) return;
      ranges.push({
        weekday: (dayIndex + 1) as Weekday,
        startPeriod: rangeStart + 1,
        endPeriod: previous + 1
      });
    };

    for (const slot of slots) {
      if (rangeStart === null) {
        rangeStart = slot;
        previous = slot;
        continue;
      }
      if (previous !== null && slot === previous + 1) {
        previous = slot;
        continue;
      }
      flush();
      rangeStart = slot;
      previous = slot;
    }
    flush();
  }
  return ranges;
}

function weekMaskToWeeks(mask: string): number[] {
  const weeks: number[] = [];
  for (let index = 1; index < mask.length; index += 1) {
    if (mask[index] === "1") weeks.push(index);
  }
  return weeks;
}

function decodeJsString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function formatWeekSummary(weeks: number[]): string {
  if (!weeks.length) return "";
  const ranges: string[] = [];
  let start = weeks[0];
  let previous = weeks[0];
  const flush = () => {
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  };
  for (const week of weeks.slice(1)) {
    if (week === previous + 1) {
      previous = week;
      continue;
    }
    flush();
    start = week;
    previous = week;
  }
  flush();
  return ranges.join(" ");
}

function decodeTimetableText(buffer: ArrayBuffer): string {
  const labels = ["gb18030", "gbk", "gb2312", "utf-8"];
  const decoded = labels.map((label) => {
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      return "";
    }
  });
  return decoded.sort((left, right) => scoreDecodedText(right) - scoreDecodedText(left))[0] || new TextDecoder().decode(buffer);
}

function scoreDecodedText(text: string): number {
  return ["个人课程表", "节次/周次", "星期一", "第一节", "学年"].reduce(
    (score, marker) => score + (text.includes(marker) ? 1 : 0),
    0
  );
}

function buildGrid(rows: HTMLTableRowElement[]): GridEntry[][] {
  const grid: GridEntry[][] = [];
  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let colIndex = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[rowIndex][colIndex]) colIndex += 1;
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const colSpan = Math.max(1, cell.colSpan || 1);
      const entry: GridEntry = { cell, anchorRow: rowIndex, anchorCol: colIndex, rowSpan, colSpan };
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ??= [];
        for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
          grid[rowIndex + rowOffset][colIndex + colOffset] = entry;
        }
      }
      colIndex += colSpan;
    }
  });
  return grid;
}

function weekdayColumns(row: GridEntry[]): Partial<Record<Weekday, number>> {
  const result: Partial<Record<Weekday, number>> = {};
  row.forEach((entry, colIndex) => {
    if (!entry || entry.anchorCol !== colIndex) return;
    const text = cellText(entry.cell);
    WEEKDAY_LABELS.forEach((label, index) => {
      if (text.includes(label)) result[(index + 1) as Weekday] = colIndex;
    });
  });
  return result;
}

function parsePeriodLabel(text: string): ImportedClassPeriod | null {
  const match = normalizeText(text).match(/第\s*([一二两三四五六七八九十百零\d]+)\s*节\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  const periodNumber = /^\d+$/.test(match[1]) ? Number(match[1]) : chineseNumberToInteger(match[1]);
  if (!periodNumber) return null;
  return {
    periodNumber,
    name: `第${match[1]}节`,
    startTime: match[2],
    endTime: match[3]
  };
}

function chineseNumberToInteger(value: string): number | null {
  if (value === "十") return 10;
  if (!value.includes("十")) return CHINESE_DIGITS[value] ?? null;
  const [tenText, oneText] = value.split("十");
  const tens = tenText ? CHINESE_DIGITS[tenText] : 1;
  const ones = oneText ? CHINESE_DIGITS[oneText] : 0;
  if (!tens && tens !== 0) return null;
  if (!ones && ones !== 0) return null;
  return tens * 10 + ones;
}

function parseScheduleCell(raw: string): Omit<ImportedCourseSchedule, "weekday" | "startPeriod" | "endPeriod" | "rawText">[] {
  const segments = raw.split(";").map((segment) => normalizeText(segment)).filter(Boolean);
  if (!segments.length) return [];

  const result: Omit<ImportedCourseSchedule, "weekday" | "startPeriod" | "endPeriod" | "rawText">[] = [];
  let pendingCourse: { name: string; teacher: string } | null = null;

  for (const segment of segments) {
    if (looksLikeWeekRoom(segment)) {
      if (!pendingCourse) continue;
      const { weeks, classroom } = parseWeekRoom(segment);
      result.push({
        ...pendingCourse,
        classroom,
        weeks
      });
      continue;
    }
    pendingCourse = parseCourseInfo(segment);
  }

  return result;
}

function parseCourseInfo(segment: string): { name: string; teacher: string } {
  const clean = stripOuterParentheses(segment);
  const match = clean.match(/^(.*)\s*[（(]([^()（）]+)[）)]$/);
  if (!match) return { name: clean.trim(), teacher: "" };
  return { name: match[1].trim(), teacher: match[2].trim() };
}

function looksLikeWeekRoom(segment: string): boolean {
  return /^[（(].*[）)]$/.test(segment) && segment.includes("周");
}

function parseWeekRoom(segment: string): { weeks: number[]; classroom: string } {
  const clean = stripOuterParentheses(segment);
  const [weekText, ...classroomParts] = clean.split(/[，,]/);
  return {
    weeks: parseWeeks(weekText),
    classroom: classroomParts.join(",").trim()
  };
}

export function parseWeeks(raw: string): number[] {
  let text = normalizeText(raw).replace(/[第周]/g, " ").trim();
  let parity: "odd" | "even" | null = null;
  if (text.startsWith("单")) {
    parity = "odd";
    text = text.slice(1).trim();
  } else if (text.startsWith("双")) {
    parity = "even";
    text = text.slice(1).trim();
  }

  const weeks = new Set<number>();
  const tokens = text.match(/\d+\s*-\s*\d+|\d+/g) ?? [];
  for (const token of tokens) {
    if (token.includes("-")) {
      const [start, end] = token.split("-").map((part) => Number(part.trim()));
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let week = min; week <= max; week += 1) weeks.add(week);
    } else {
      const week = Number(token);
      if (Number.isFinite(week)) weeks.add(week);
    }
  }

  return Array.from(weeks)
    .filter((week) => week > 0)
    .filter((week) => (parity === "odd" ? week % 2 === 1 : parity === "even" ? week % 2 === 0 : true))
    .sort((left, right) => left - right);
}

function stripOuterParentheses(value: string): string {
  const text = normalizeText(value);
  const startsWithParenthesis = text.startsWith("(") || text.startsWith("（");
  const endsWithParenthesis = text.endsWith(")") || text.endsWith("）");
  return startsWithParenthesis && endsWithParenthesis ? text.slice(1, -1).trim() : text;
}

function cellText(cell: HTMLTableCellElement): string {
  return normalizeText(cell.textContent ?? "");
}

function cellHtmlText(cell: HTMLTableCellElement): string {
  return normalizeText(
    cell.innerHTML
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
  );
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}
