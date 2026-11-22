import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { parseAttachmentSchedule, wantsAttachmentSchedule } from "./attachmentSchedule.ts";

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
    sourceRowCounts: [{ sourceIndex: 1, count: 5 }, { sourceIndex: 2, count: 4 }, { sourceIndex: 3, count: 5 }],
    rows: dates.map(([startDate, endDate], index) => ({
      sourceIndex: index < 5 ? 1 : index < 9 ? 2 : 3,
      rowIndex: index < 5 ? index + 1 : index < 9 ? index - 4 : index - 8,
      startDate, endDate, title: titles[index], details: `第${index + 1}行的具体学习内容，公式(1)～(7)与图4完整保留。`, outcome: `第${index + 1}行的预期成果`,
      startTime: null, endTime: null
    })),
    selectedRows: null as null | Array<{ sourceIndex: number; rowIndex: number }>,
    folderNames: ["毕设"],
    memoRequest: { title: "开题前准备", folderName: "毕设", format: "numbered" },
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

Deno.test("提问、修正已有事项和单独写备忘录不会进入附件创建流程", () => {
  assertEquals(wantsAttachmentSchedule(question, 3), true);
  assertEquals(wantsAttachmentSchedule("请识别附件中的日程信息，并创建对应事项。", 3), true);
  assertEquals(wantsAttachmentSchedule("为什么只创建了一个事项？", 3), false);
  assertEquals(wantsAttachmentSchedule("按图修改之前创建的事项", 3), false);
  assertEquals(wantsAttachmentSchedule("把附件整理成备忘录", 3), false);
  assertEquals(wantsAttachmentSchedule("创建每天重复的习惯事项", 3), false);
  assertEquals(wantsAttachmentSchedule(question, 0), false);
});
