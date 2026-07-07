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
});

function anniversaryRecord(id: string, title: string, kind: AnniversaryKind): Anniversary {
  return {
    ...syncFields(),
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
