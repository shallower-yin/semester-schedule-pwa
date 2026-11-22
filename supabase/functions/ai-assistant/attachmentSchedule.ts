import type { AiAssistantAction, ParsedAssistantResponse } from "./requestTypes.ts";
import { DiagnosticError } from "./requestContext.ts";
import { parseMindMapJson } from "../_shared/mindMapJson.ts";

export const MAX_ATTACHMENT_SCHEDULE_ROWS = 64;

export function wantsAttachmentSchedule(question: string, attachmentCount: number): boolean {
  if (/(修改|更改|调整|更新|删除|移除|取消(?!提醒))/.test(question)) return false;
  if (/(为什么|为何|原因|怎么回事)/.test(question) && !/(请|帮我|给我|麻烦).{0,16}(创建|添加|录入|记录|导入)/.test(question)) return false;
  return attachmentCount > 0
    && /(创建|新建|添加|加入|录入|记录|导入|安排|生成|记到|记在|记下|帮我记)/.test(question)
    && /(事项|日程)/.test(question)
    && !/(习惯|重复|每天|每周|工作日|每月|每隔)/.test(question)
    && !/(不要|不用|无需|不需要|别).{0,5}(创建|添加|录入|记录|导入).{0,3}(事项|日程)/.test(question);
}

export function attachmentScheduleInstructions(attachmentCount: number, now: string): string {
  return [
    "你负责提取附件中的日程表格。只提取资料和用户明确要求的操作，不要自行执行或声称已完成。",
    `当前北京时间：${now}。附件按输入顺序编号 1-${attachmentCount}；用户文字中另外明确新增的事项使用 sourceIndex=0。`,
    "必须读取所有附件、所有日期行；跨图片的续表接着处理。每一行就是一个独立任务，不能把多行合并成一个总事项。",
    "先数出每份附件的日期行数，再逐行提取，sourceRowCounts 与 rows 数量必须相同。不是日程的附件填 count=0。rowIndex 在每份附件中从 1 连续递增。",
    "按用户要求映射各列；默认第一列是日期，第二列是任务标题，第三列是 details（具体内容），第四列是 outcome（预期成果）。没有表格时每个独立活动提取为一行；没有相应内容的单元格填空字符串。完整保留正文，不要摘要、漏项或改写公式和章节编号。",
    "startDate/endDate 只来自对应行的日期列；有年份用 YYYY-MM-DD，没有年份用 MM-DD，不得拿论文年份、文件名或研究年份作日期年份。跨月、跨年都保留原来的起止月日，单日的两者相同。",
    "没有标注年份是正常输入，不属于识别疑问：应用以当前北京时间所在年作为计划起始年，按任务顺序遇到12月至1月会自动顺延到次年。12-28至01-03明确表示跨年区间，不需要用户确认年份，也不能将缺少年份或正常跨年写入uncertainties。",
    "日期范围表示任务阶段，保留整个阶段，不能只保留第一天。不要编造小时；确有时刻才写 startTime/endTime（HH:mm），否则写 null。",
    "图片明确给出的活动地点填写 location；没有则空字符串。没有日期的任务不要猜测今天或明天，将所需的日期信息写入 uncertainties，应用会向用户询问。",
    "用户明确要求全天时保留日期区间，应用会设为全天。用户要求不用提醒时绝不能开启提醒。",
    "用户只选某几行时在 selectedRows 中逐项填写 sourceIndex/rowIndex；没有明确筛选时 selectedRows=null，应用将导入全部行。",
    "用户还要求备忘录时填写 memoRequest；标题、文件夹名称必须按原话填写，未指定文件夹时 folderName=null；待办、勾选、完成清单使用 format=checklist，纯编号使用 numbered，其他使用 plain。备忘录默认包含所有选中行。",
    "用户要求新建的文件夹逐个填入 folderNames；仅写文件夹名称不是创建完成，不能把创建文件夹省略为一句说明。",
    `最多 ${MAX_ATTACHMENT_SCHEDULE_ROWS} 行；看不清、日期不确定、超出行数时在 uncertainties 中说明，不能输出猜测的日期。`,
    "只返回 JSON，不要返回 actions 或 Markdown。格式：",
    '{"sourceRowCounts":[{"sourceIndex":1,"count":1}],"rows":[{"sourceIndex":1,"rowIndex":1,"startDate":"12-28","endDate":"01-03","title":"任务","details":"完整具体内容","outcome":"完整预期成果","startTime":null,"endTime":null}],"selectedRows":null,"folderNames":[],"memoRequest":{"title":"标题","folderName":null,"format":"checklist"},"uncertainties":[]}',
    "文字单元格、文件夹名和备忘录标题用字符串；多行内容在同一个字符串中用换行连接，空单元格用空字符串。folderNames 是名称字符串数组，uncertainties 是疑问字符串数组。行号、附件编号和数量用数字。",
    "不需要备忘录时 memoRequest=null。不要漏掉 rows，不要把用户的命令当作任务正文。"
  ].join("\n");
}

interface Row {
  sourceIndex: number;
  rowIndex: number;
  startDate: string;
  endDate: string;
  title: string;
  note: string;
  startTime: string | null;
  endTime: string | null;
  location: string;
}

function fail(reason: string, details: Record<string, unknown> = {}): never {
  throw new DiagnosticError(`未导入任何记录：${reason}`, { stage: "attachment_schedule_validation", ...details });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("表格提取结果格式不完整，请重试。");
  return value as Record<string, unknown>;
}

function text(value: unknown, limit = 10_000, label = "表格文字", field = "", allowNumber = true, depth = 0): string {
  if (value == null) return "";
  let result: string;
  if (typeof value === "string") result = value;
  else if (allowNumber && typeof value === "number" && Number.isFinite(value)) result = String(value);
  else if (depth < 4 && Array.isArray(value)) {
    result = value.map((item) => text(item, limit, label, field, allowNumber, depth + 1)).filter(Boolean).join("\n");
  } else if (depth < 4 && typeof value === "object" && !Array.isArray(value)) {
    const cell = value as Record<string, unknown>;
    const keys = ["text", "content", "value", "name", "message", "reason", "lines", "items"].filter((key) => cell[key] != null);
    if (keys.length === 1) return text(cell[keys[0]], limit, label, field, allowNumber, depth + 1);
    fail(`${label}的识别结果格式不正确，请重试。`, { field, issue: "text_format", receivedType: "object" });
  } else {
    fail(`${label}的识别结果格式不正确，请重试。`, { field, issue: "text_format", receivedType: Array.isArray(value) ? "array" : typeof value });
  }
  if (result.length > limit) fail(`${label}超过 ${limit} 个字符，请缩短该项内容后重试。`, { field, issue: "text_length", receivedLength: result.length, limit });
  return result.trim();
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail("表格行号或数量不完整，请重试。");
  return value;
}

function dateParts(value: string): { year: number | null; month: number; day: number } {
  const match = /^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?$/.exec(value);
  if (!match) fail(`日期“${value}”无法确定，请补充年月日。`);
  return { year: match[1] ? Number(match[1]) : null, month: Number(match[2]), day: Number(match[3]) };
}

function isoDate(parts: ReturnType<typeof dateParts>, year: number): string {
  const date = new Date(Date.UTC(year, parts.month - 1, parts.day));
  if (year < 1900 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) {
    fail(`日期 ${year}-${parts.month}-${parts.day} 不存在，请核对。`);
  }
  return `${year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function time(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("表格中的时刻无法确定，请核对。");
  return value;
}

export function parseAttachmentSchedule(content: string, question: string, attachmentCount: number, now = new Date()): ParsedAssistantResponse {
  let parsed: Record<string, unknown>;
  try {
    parsed = object(parseMindMapJson(content).value);
  } catch {
    fail("表格提取结果不完整，请重试。");
  }
  const rawUncertainties = parsed.uncertainties == null ? [] : Array.isArray(parsed.uncertainties) ? parsed.uncertainties : [parsed.uncertainties];
  const uncertainties = rawUncertainties.map((item, index) => text(item, 500, "识别疑问", `uncertainties[${index}]`))
    .filter((message) => message && !isResolvableYearNotice(message));
  if (uncertainties.length) fail(uncertainties.join("；"), { field: "uncertainties", issue: "uncertain_source" });
  if (!Array.isArray(parsed.rows) || !parsed.rows.length || parsed.rows.length > MAX_ATTACHMENT_SCHEDULE_ROWS || !Array.isArray(parsed.sourceRowCounts)) {
    fail(`未提取到完整任务，或任务超过 ${MAX_ATTACHMENT_SCHEDULE_ROWS} 行，请核对附件或分批导入。`);
  }
  const counts = new Map<number, number>();
  for (const value of parsed.sourceRowCounts) {
    const source = object(value);
    const index = integer(source.sourceIndex, 0, attachmentCount);
    if (counts.has(index)) fail("附件行数重复，请重试。");
    counts.set(index, integer(source.count, 0, MAX_ATTACHMENT_SCHEDULE_ROWS));
  }
  for (let index = 1; index <= attachmentCount; index++) {
    if (!counts.has(index)) fail(`第 ${index} 份附件尚未完整读取，请重试。`);
  }
  const rawRows = parsed.rows.map((value): Record<string, unknown> & { sourceIndex: number; rowIndex: number } => {
    const row = object(value);
    return { ...row, sourceIndex: integer(row.sourceIndex, 0, attachmentCount), rowIndex: integer(row.rowIndex, 1, MAX_ATTACHMENT_SCHEDULE_ROWS) };
  }).sort((a, b) => {
    const sourceA = a.sourceIndex || attachmentCount + 1;
    const sourceB = b.sourceIndex || attachmentCount + 1;
    return sourceA - sourceB || a.rowIndex - b.rowIndex;
  });
  const rowIds = new Set<string>();
  for (const row of rawRows) {
    const source = integer(row.sourceIndex, 0, attachmentCount);
    const ordinal = integer(row.rowIndex, 1, MAX_ATTACHMENT_SCHEDULE_ROWS);
    const id = `${source}:${ordinal}`;
    if (rowIds.has(id) || !counts.has(source) || ordinal > counts.get(source)!) fail("表格存在遗漏或重复行，请重试。");
    rowIds.add(id);
  }
  for (const [source, count] of counts) {
    if (rawRows.filter((row) => row.sourceIndex === source).length !== count) fail(`第 ${source} 份资料的任务数量与原表行数不一致，请重试。`);
  }
  let year = Number(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai", year: "numeric" }));
  let previousMonth = 0;
  const rows: Row[] = rawRows.map((raw, index) => {
    const label = raw.sourceIndex ? `第 ${raw.sourceIndex} 份附件第 ${raw.rowIndex} 行` : `用户补充的第 ${raw.rowIndex} 项`;
    const field = `rows[${index}]`;
    const startText = text(raw.startDate, 30, `${label}的开始日期`, `${field}.startDate`, false);
    const start = dateParts(startText);
    const end = dateParts(text(raw.endDate, 30, `${label}的结束日期`, `${field}.endDate`, false) || startText);
    if (start.year) year = start.year;
    else if (previousMonth === 12 && start.month === 1) year++;
    previousMonth = start.month;
    const startDate = isoDate(start, year);
    const endYear = end.year ?? (end.month < start.month ? year + 1 : year);
    const endDate = isoDate(end, endYear);
    if (endDate < startDate) fail("结束日期早于开始日期，请核对年份。");
    const title = text(raw.title, 500, `${label}的标题`, `${field}.title`);
    if (!title) fail("表格中有任务缺少标题，请核对。");
    if (!Object.hasOwn(raw, "details") || !Object.hasOwn(raw, "outcome")) fail(`${label}的具体内容或预期成果尚未提取完整，请重试。`, { field, issue: "missing_cell" });
    const details = text(raw.details, 10_000, `${label}的具体内容`, `${field}.details`);
    const outcome = text(raw.outcome, 10_000, `${label}的预期成果`, `${field}.outcome`);
    const startTime = time(raw.startTime);
    const endTime = time(raw.endTime) ?? startTime;
    if (!startTime && endTime) fail("表格中有任务缺少开始时刻，请核对。");
    if (startDate === endDate && startTime && endTime && endTime < startTime) fail("结束时刻早于开始时刻，请核对。");
    return {
      sourceIndex: raw.sourceIndex as number, rowIndex: raw.rowIndex as number,
      startDate, endDate, title, startTime, endTime,
      location: text(raw.location, 200, `${label}的地点`, `${field}.location`),
      note: [details && `具体内容：${details}`, outcome && `预期成果：${outcome}`].filter(Boolean).join("\n")
    };
  });
  let selected = rows;
  if (parsed.selectedRows != null) {
    if (!Array.isArray(parsed.selectedRows) || !parsed.selectedRows.length) fail("没有选中可创建的任务，请核对。");
    const selectedIds = parsed.selectedRows.map((value) => {
      const ref = object(value);
      return `${integer(ref.sourceIndex, 0, attachmentCount)}:${integer(ref.rowIndex, 1, MAX_ATTACHMENT_SCHEDULE_ROWS)}`;
    });
    if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !rowIds.has(id))) fail("选中的表格行不存在或重复，请核对。");
    if (!/(只|仅|第.{0,10}行|筛选|选中|选出|除外|不要.{0,8}(行|任务))/.test(question) && selectedIds.length !== rows.length) fail("未按要求提取全部任务，请重试。");
    selected = rows.filter((row) => selectedIds.includes(`${row.sourceIndex}:${row.rowIndex}`));
  }
  const allDayRequested = /全天/.test(question) && !/(不要|不用|别|不是).{0,3}全天/.test(question);
  const remindersDisabled = /(不用|不要|无需|不需要|不必|关闭|取消).{0,4}提醒/.test(question);
  const remindersRequested = !remindersDisabled && /(提醒我|需要提醒|开启提醒|设置提醒)/.test(question);
  const actions: AiAssistantAction[] = selected.map((row) => ({
    type: "create_event", eventType: "event", title: row.title,
    startDate: row.startDate, endDate: row.endDate,
    startTime: allDayRequested ? null : row.startTime, endTime: allDayRequested ? null : row.endTime,
    allDay: allDayRequested || !row.startTime, note: row.note,
    location: row.location,
    recurrenceType: "none", reminderEnabled: remindersRequested, reminderMinutesBefore: 10
  }));
  const rawFolderNames = parsed.folderNames == null ? [] : Array.isArray(parsed.folderNames) ? parsed.folderNames : [parsed.folderNames];
  const folderNames = rawFolderNames.map((name, index) => text(name, 200, "文件夹名称", `folderNames[${index}]`));
  let memoAction: Extract<AiAssistantAction, { type: "create_memo" }> | null = null;
  if (parsed.memoRequest != null) {
    const memo = object(parsed.memoRequest);
    const title = text(memo.title, 500, "备忘录标题", "memoRequest.title");
    if (!title) fail("备忘录缺少标题，请补充。");
    const folderName = text(memo.folderName, 200, "备忘录的文件夹名称", "memoRequest.folderName");
    if (folderName) folderNames.push(folderName);
    const format = /(勾选|可选中|待办|打勾|复选)/.test(question) ? "checklist" : memo.format === "numbered" ? "numbered" : memo.format === "checklist" ? "checklist" : "plain";
    memoAction = {
      type: "create_memo", title, folderName: folderName || null, format,
      items: selected.map((row) => ({ text: `${row.startDate}${row.endDate !== row.startDate ? ` 至 ${row.endDate}` : ""} ${row.title}${row.note ? `\n${row.note}` : ""}`, completed: false }))
    };
  } else if (/(创建|新建|建|写).{0,12}(备忘录|备忘)/.test(question)) {
    fail("备忘录要求尚未提取完整，请重试。");
  }
  if (/(创建|新建|建).{0,12}文件夹/.test(question) && !folderNames.some(Boolean)) fail("新建文件夹的名称尚未提取，请重试。");
  actions.push(...[...new Set(folderNames.filter(Boolean))].map((name) => ({ type: "create_memo_folder" as const, name })));
  if (memoAction) actions.push(memoAction);
  return { answer: "已提取附件中的任务。", actions };
}

function isResolvableYearNotice(message: string): boolean {
  const missingYear = /(未.{0,4}(标注|注明|提供|给出|指定).{0,3}年份|未标年份|没有.{0,4}年份|缺少.{0,3}年份|无年份|年份未)/.test(message);
  // Numeric month/day validity and ordering are still validated below. Only a
  // missing year is deterministic; unreadable, contradictory or missing dates
  // must continue to stop the import.
  return missingYear && !/(看不清|不清晰|模糊|辨认|无法识别|日期缺失|缺少日期|月份不明|日期不明|冲突|矛盾)/.test(message);
}
