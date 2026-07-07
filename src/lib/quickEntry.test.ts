import { describe, expect, it } from "vitest";
import { parseQuickEntry } from "./quickEntry";

const base = new Date(2026, 6, 8, 10, 0, 0);

describe("快速录入解析", () => {
  it("解析今天、明天和后天", () => {
    expect(parseQuickEntry("今天 18点30 写实验报告", base)).toMatchObject({
      date: "2026-07-08",
      startTime: "18:30",
      title: "写实验报告"
    });
    expect(parseQuickEntry("明天 9:00 交作业", base)).toMatchObject({
      date: "2026-07-09",
      startTime: "09:00",
      title: "交作业"
    });
    expect(parseQuickEntry("后天 晚上8点 背单词", base)).toMatchObject({
      date: "2026-07-10",
      startTime: "20:00",
      title: "背单词"
    });
  });

  it("解析这周几和下周几", () => {
    expect(parseQuickEntry("这周五 14:30 开组会", base)).toMatchObject({
      date: "2026-07-10",
      startTime: "14:30"
    });
    expect(parseQuickEntry("下周一 8点10 上机测试", base)).toMatchObject({
      date: "2026-07-13",
      startTime: "08:10"
    });
  });

  it("解析月日和数字日期", () => {
    expect(parseQuickEntry("7月18日 19:00 看电影", base)).toMatchObject({
      date: "2026-07-18",
      startTime: "19:00"
    });
    expect(parseQuickEntry("2026/8/1 9点 整理材料", base)).toMatchObject({
      date: "2026-08-01",
      startTime: "09:00"
    });
  });

  it("格式不完整时返回 null", () => {
    expect(parseQuickEntry("明天 交作业", base)).toBeNull();
    expect(parseQuickEntry("今天 9点", base)).toBeNull();
  });
});
