import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { parseAttachmentSchedule } from "./attachmentSchedule.ts";
import { DiagnosticError } from "./requestContext.ts";

const question = "帮我记录到全天事项里面，不用提醒，第三四列放到备注里面，同时创建新的文件夹，命名毕设，然后创建一个备忘录开题前准备，里面放上这些要干的事情，列表编号用待办，可勾选完成的那种";
const now = new Date("2026-11-22T03:00:00+08:00");

function studyPlan() {
  const dates = [
    ["11-22", "11-28"], ["11-29", "12-02"], ["12-03", "12-06"], ["12-07", "12-09"], ["12-10", "12-13"],
    ["12-14", "12-15"], ["12-16", "12-17"], ["12-18", "12-19"], ["12-20", "12-20"],
    ["12-21", "12-24"], ["12-25", "12-27"], ["12-28", "01-03"], ["01-04", "01-08"], ["01-09", "01-12"]
  ];
  const titles = ["2022年论文第2.1、2.2节", "2022年论文第2.2、3.1.1节", "2022年论文第3.1.2、3.3节", "2024年论文第0、1.1、1.2节", "2024年论文第2、3节", "毕伟尧博士论文", "梅斌博士论文", "解增辉博士论文", "罗璇博士论文", "已有研究成果整理", "现有研究资源梳理", "毕设开题方案设计", "开题报告撰写", "开题材料修改定稿"];
  return {
    request: { createEvents: true, createMemo: true, createFolders: true, scope: "all", allDay: true, reminderEnabled: false },
    sourceRowCounts: [{ sourceIndex: 1, count: 5 }, { sourceIndex: 2, count: 4 }, { sourceIndex: 3, count: 5 }],
    rows: dates.map(([startDate, endDate], index) => ({
      sourceIndex: index < 5 ? 1 : index < 9 ? 2 : 3,
      rowIndex: index < 5 ? index + 1 : index < 9 ? index - 4 : index - 8,
      startDate, endDate, title: titles[index], details: `第${index + 1}行的具体学习内容，公式(1)～(7)与图4完整保留。`, outcome: `第${index + 1}行的预期成果`,
      startTime: null, endTime: null
    })),
    selectedRows: null as null | Array<{ sourceIndex: number; rowIndex: number }>,
    folderNames: ["毕设"],
    memoRequest: { title: "开题前准备", folderName: "毕设", format: "checklist" },
    uncertainties: [] as string[]
  };
}

Deno.test("三份续表的14行生成14个全天事项、文件夹和14条可勾选待办", () => {
  const plan = studyPlan();
  const result = parseAttachmentSchedule(JSON.stringify(plan), question, 3, now);
  const events = result.actions.filter((action) => action.type === "create_event");
  assertEquals(events.length, 14);
  assertEquals(events[0].startDate, "2026-11-22");
  assertEquals(events[0].endDate, "2026-11-28");
  assertEquals(events[11].startDate, "2026-12-28");
  assertEquals(events[11].endDate, "2027-01-03");
  assertEquals(events[12].startDate, "2027-01-04");
  assertEquals(events[13].endDate, "2027-01-12");
  assertEquals(events.map((action) => action.title), plan.rows.map((row) => row.title));
  assertEquals(events.every((action) => action.allDay && action.startTime === null && !action.reminderEnabled && action.recurrenceType === "none"), true);
  assertStringIncludes(events[0].note!, plan.rows[0].details);
  assertStringIncludes(events[0].note!, plan.rows[0].outcome);
  assertEquals(result.actions.filter((action) => action.type === "create_memo_folder"), [{ type: "create_memo_folder", name: "毕设" }]);
  const memo = result.actions.find((action) => action.type === "create_memo");
  assertEquals(memo?.title, "开题前准备");
  assertEquals(memo?.folderName, "毕设");
  assertEquals(memo?.format, "checklist");
  assertEquals(memo?.items?.length, 14);
  assertStringIncludes(memo!.items![13].text, "2027-01-09 至 2027-01-12");
});

Deno.test("完整保留超过200字的表格备注和换行", () => {
  const plan = studyPlan();
  plan.rows[0].details = "结构参数、刚度模型与公式推导。".repeat(35) + "\n末尾内容不得丢失";
  const event = parseAttachmentSchedule(JSON.stringify(plan), question, 3, now).actions[0];
  if (event.type !== "create_event") throw new Error("Expected event");
  assertStringIncludes(event.note!, plan.rows[0].details);
  assertStringIncludes(event.note!, "末尾内容不得丢失");
});

Deno.test("缺行、漏附件、重复行和不存在的日期均拒绝整批写入", () => {
  const missing = studyPlan();
  missing.rows.pop();
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missing), question, 3, now), Error, "数量");
  const missingSource = studyPlan();
  missingSource.sourceRowCounts.splice(1, 1);
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missingSource), question, 3, now), Error, "第 2 份附件");
  const duplicate = studyPlan();
  duplicate.rows[1] = { ...duplicate.rows[0] };
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(duplicate), question, 3, now), Error, "遗漏或重复");
  const invalid = studyPlan();
  invalid.rows[0].startDate = "2026-02-30";
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(invalid), question, 3, now), Error, "不存在");
});

Deno.test("用户未筛选时不能自行只导入部分表格行", () => {
  const plan = studyPlan();
  plan.selectedRows = [{ sourceIndex: 3, rowIndex: 1 }];
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(plan), question, 3, now), Error, "全部任务");
  plan.request.scope = "selected";
  const result = parseAttachmentSchedule(JSON.stringify(plan), question + "，只导入第三张图第一行", 3, now);
  assertEquals(result.actions.filter((action) => action.type === "create_event").length, 1);
});

Deno.test("日期不明确以及遗漏文件夹或备忘录要求时不生成部分操作", () => {
  const uncertain = studyPlan();
  uncertain.uncertainties.push("第三张图日期看不清");
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(uncertain), question, 3, now), Error, "看不清");
  const missingMemo = { ...studyPlan(), memoRequest: null };
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missingMemo), question, 3, now), Error, "备忘录要求");
  const missingFolder = studyPlan();
  missingFolder.folderNames = [];
  missingFolder.memoRequest.folderName = "";
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missingFolder), question, 3, now), Error, "文件夹");
});

Deno.test("模型把单元格输出成分行数组或文字对象时仍导入全部14行", () => {
  const original = studyPlan();
  const normalized = parseAttachmentSchedule(JSON.stringify(original), question, 3, now);
  const variant = {
    ...original,
    sourceRowCounts: original.sourceRowCounts.map(({ sourceIndex, count }) => ({ sourceIndex: String(sourceIndex), count: String(count) })),
    rows: original.rows.map((row) => ({
      ...row,
      sourceIndex: String(row.sourceIndex), rowIndex: String(row.rowIndex),
      startDate: { value: row.startDate }, endDate: { text: row.endDate },
      title: { text: row.title }, details: [{ text: row.details }], outcome: [row.outcome]
    })),
    folderNames: [{ name: "毕设" }],
    memoRequest: { title: { text: "开题前准备" }, folderName: { name: "毕设" }, format: "checklist" }
  };
  assertEquals(parseAttachmentSchedule(JSON.stringify(variant), question, 3, now), normalized);
});

Deno.test("多行单元格完整保留，空白单元格的null不会阻止创建", () => {
  const original = studyPlan();
  const variant = {
    ...original,
    rows: original.rows.map((row, index) => index === 0
      ? { ...row, details: ["第2.1节：机构组成", { text: "第2.2节：公式(1)～(7)" }], outcome: { content: "解释位姿和支链长度" } }
      : index === 1 ? { ...row, outcome: null } : row)
  };
  const events = parseAttachmentSchedule(JSON.stringify(variant), question, 3, now).actions.filter((action) => action.type === "create_event");
  assertEquals(events.length, 14);
  assertEquals(events[0].note, "具体内容：第2.1节：机构组成\n第2.2节：公式(1)～(7)\n预期成果：解释位姿和支链长度");
  assertStringIncludes(events[1].note!, original.rows[1].details);
});

Deno.test("未知文字结构提示具体字段，不再误报内容太长要求分批", () => {
  const plan = studyPlan();
  const error = assertThrows(() => parseAttachmentSchedule(JSON.stringify({
    ...plan, rows: plan.rows.map((row, index) => index === 0 ? { ...row, title: { unexpected: "任务" } } : row)
  }), question, 3, now), Error);
  assertStringIncludes(error.message, "第 1 份附件第 1 行的标题");
  assertEquals(error.message.includes("分批"), false);
  assertEquals(error.message.includes("过长"), false);
  assertEquals((error as DiagnosticError).details, { stage: "attachment_schedule_validation", field: "rows[0].title", issue: "text_format", receivedType: "object" });
});

Deno.test("真正超长时指出具体字段和长度限制", () => {
  const plan = studyPlan();
  plan.rows[0].details = "内".repeat(10_001);
  const error = assertThrows(() => parseAttachmentSchedule(JSON.stringify(plan), question, 3, now), Error);
  assertStringIncludes(error.message, "第 1 份附件第 1 行的具体内容");
  assertStringIncludes(error.message, "10000");
});

Deno.test("结构化识别疑问保留具体原因，不会伪装成文件过大", () => {
  const plan = studyPlan();
  const error = assertThrows(() => parseAttachmentSchedule(JSON.stringify({
    ...plan, uncertainties: [{ sourceIndex: 3, rowIndex: 2, message: "第三张图第二行的日期看不清" }]
  }), question, 3, now), Error);
  assertStringIncludes(error.message, "第三张图第二行的日期看不清");
  assertEquals(error.message.includes("过长"), false);
});

Deno.test("格式兼容不会把数字日期或重复行号悄悄当成正确任务", () => {
  const plan = studyPlan();
  assertThrows(() => parseAttachmentSchedule(JSON.stringify({
    ...plan, rows: plan.rows.map((row, index) => index === 0 ? { ...row, startDate: { value: 11.22 } } : row)
  }), question, 3, now), Error, "开始日期");
  assertThrows(() => parseAttachmentSchedule(JSON.stringify({
    ...plan, rows: plan.rows.map((row, index) => index === 1 ? { ...row, sourceIndex: "1", rowIndex: "1" } : row)
  }), question, 3, now), Error, "遗漏或重复");
});

Deno.test("线上原图返回的无年份跨年说明按既定年份规则处理，不阻止14个事项创建", () => {
  const plan = studyPlan();
  plan.uncertainties = ["附件中日期均未标注年份，已按无年份的 MM-DD 格式提取；12-28 至 01-03、01-04 至 01-08、01-09 至 01-12 跨年区间请确认是否为 12-28 至 01-03 等跨年日期。"];
  const result = parseAttachmentSchedule(JSON.stringify(plan), question, 3, now);
  const events = result.actions.filter((action) => action.type === "create_event");
  assertEquals(events.length, 14);
  assertEquals(events[11].endDate, "2027-01-03");
  assertEquals(events[13].endDate, "2027-01-12");
  plan.uncertainties.push("第三张图第二行的日期看不清");
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(plan), question, 3, now), Error, "看不清");
  plan.uncertainties = ["没有年份，日期也看不清"];
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(plan), question, 3, now), Error, "看不清");
});

Deno.test("任务语义由模型给出，程序不依赖追问里的触发词", () => {
  const request = { createEvents: true, createMemo: true, createFolders: true, scope: "all", allDay: true, reminderEnabled: false };
  for (const followup of ["重新处理", "继续处理", "剩下的也弄好", "照刚才的意思来", "嗯，都帮我记好吧"]) {
    const plan = { ...studyPlan(), request, memoRequest: { title: "开题前准备", folderName: "毕设", format: "checklist" } };
    const result = parseAttachmentSchedule(JSON.stringify(plan), followup, 3, now, ["image-1", "image-2", "image-3"]);
    assertEquals(result.actions.filter((action) => action.type === "create_event").length, 14);
    const memo = result.actions.find((action) => action.type === "create_memo");
    assertEquals(memo?.items?.length, 14);
    assertEquals(memo?.folderName, "毕设");
    assertEquals(memo?.format, "checklist");
    assertEquals(result.actions[0].type === "create_event" && result.actions[0].sourceKey, "image-1:row:1");
  }
  const memoOnly = parseAttachmentSchedule(JSON.stringify({ ...studyPlan(), request: { ...request, createEvents: false } }), "整理成那种能勾选的", 3, now);
  assertEquals(memoOnly.actions.filter((action) => action.type === "create_event").length, 0);
  assertEquals(memoOnly.actions.some((action) => action.type === "create_memo"), true);
  const missingMemo = { ...studyPlan(), request, memoRequest: null };
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missingMemo), "继续", 3, now), Error, "备忘录");
  const missingSource = { ...studyPlan(), request, rows: studyPlan().rows.slice(0, 5) };
  assertThrows(() => parseAttachmentSchedule(JSON.stringify(missingSource), "继续", 3, now), Error, "数量");
});
