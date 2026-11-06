import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setCurrentUserId, syncFields } from "../lib/identity";
import type { Anniversary, AnniversaryKind } from "../types";
import { AnniversaryPage } from "./AnniversaryPage";

describe("纪念日页面", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.anniversaries.clear();
    await db.syncQueue.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("按展示列表筛选纪念日、生日和节日", async () => {
    await db.anniversaries.bulkAdd([
      anniversaryRecord("anniversary-1", "相识纪念", "anniversary"),
      anniversaryRecord("birthday-1", "妈妈生日", "birthday"),
      anniversaryRecord("holiday-1", "春节", "holiday")
    ]);

    render(<AnniversaryPage ownerId="local" />);

    await waitFor(() => expect(screen.getByText("妈妈生日")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /生日/ }));

    expect(screen.getByText("妈妈生日")).toBeInTheDocument();
    expect(screen.queryByText("相识纪念")).not.toBeInTheDocument();
    expect(screen.queryByText("春节")).not.toBeInTheDocument();
  });

  it("新增日子后写入本地表和同步队列", async () => {
    render(<AnniversaryPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增日子/ }));
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "holiday" } });
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "测试节日" } });
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-07-07" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(async () => {
      const saved = await db.anniversaries.filter((item) => item.title === "测试节日").first();
      expect(saved).toEqual(expect.objectContaining({ kind: "holiday", date: "2026-07-07" }));
    });
    await waitFor(async () => {
      expect(await db.syncQueue.where("table_name").equals("anniversaries").count()).toBe(1);
    });
  });

  it("新增农历日子时保存农历字段和换算后的公历日期", async () => {
    render(<AnniversaryPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: /新增日子/ }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "中秋节" } });
    fireEvent.change(screen.getByLabelText("历法"), { target: { value: "lunar" } });
    fireEvent.change(screen.getByLabelText("农历年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("农历月份"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("农历日期"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(async () => {
      const saved = await db.anniversaries.filter((item) => item.title === "中秋节").first();
      expect(saved).toEqual(expect.objectContaining({
        calendar_type: "lunar",
        lunar_year: 2026,
        lunar_month: 8,
        lunar_day: 15,
        date: "2026-09-25"
      }));
    });
  });

  it("跨标签切换共享身份后，新建日子仍归属打开弹窗的账号", async () => {
    setCurrentUserId("alice");
    render(<AnniversaryPage ownerId="alice" />);

    fireEvent.click(screen.getByRole("button", { name: /新增日子/ }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Alice 的纪念日" } });
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-30" } });
    setCurrentUserId("bob");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(async () => {
      const saved = await db.anniversaries.filter((item) => item.title === "Alice 的纪念日").first();
      expect(saved?.user_id).toBe("alice");
    });
  });

  it("农历切换到公历再切回时保留刚输入的日期", async () => {
    render(<AnniversaryPage ownerId="local" />);
    fireEvent.click(screen.getByRole("button", { name: /新增日子/ }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "农历生日" } });
    fireEvent.change(screen.getByLabelText("历法"), { target: { value: "lunar" } });
    fireEvent.change(screen.getByLabelText("农历年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("农历月份"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("农历日期"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("历法"), { target: { value: "solar" } });
    expect(screen.getByLabelText("日期")).toHaveValue("2026-09-25");
    fireEvent.change(screen.getByLabelText("历法"), { target: { value: "lunar" } });
    expect(screen.getByLabelText("农历年份")).toHaveValue(2026);
    expect(screen.getByLabelText("农历月份")).toHaveValue("8");
    expect(screen.getByLabelText("农历日期")).toHaveValue("15");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => expect(await db.anniversaries.filter((item) => item.title === "农历生日").first())
      .toMatchObject({ date: "2026-09-25", calendar_type: "lunar", lunar_month: 8, lunar_day: 15 }));
  });

  it("编辑除夕时显示该年真实农历年末，并保存每年的除夕", async () => {
    await db.anniversaries.add({
      ...anniversaryRecord("year-end", "除夕", "holiday"),
      date: "2024-02-09", calendar_type: "lunar", lunar_year: 2023,
      lunar_month: 12, lunar_day: 30
    });
    render(<AnniversaryPage ownerId="local" />);
    await waitFor(() => expect(screen.getByText("除夕")).toBeInTheDocument());
    fireEvent.click(screen.getByText("除夕"));
    fireEvent.change(screen.getByLabelText("农历年份"), { target: { value: "2026" } });
    expect(screen.getByLabelText("农历日期")).toHaveValue("29");
    expect(screen.getByLabelText("农历日期")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => {
      const saved = await db.anniversaries.get("year-end");
      expect(saved).toMatchObject({ date: "2027-02-05", lunar_year: 2026, lunar_month: 12, lunar_day: 29 });
      expect(saved?.lunar_occurrence_dates).toContain("2028-01-25");
    });
  });
});

function anniversaryRecord(id: string, title: string, kind: AnniversaryKind): Anniversary {
  return {
    ...syncFields(undefined, "local"),
    id,
    title,
    kind,
    date: "2020-07-07",
    color: "#d97706",
    note: "",
    reminder_enabled: false,
    reminder_days_before: 0,
    reminder_time: "09:00",
    reminder_sent_for: null,
    timezone: "Asia/Shanghai"
  };
}
