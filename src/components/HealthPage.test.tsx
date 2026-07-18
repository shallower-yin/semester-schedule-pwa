import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { HealthPage } from "./HealthPage";

describe("健康第一阶段", () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.transaction("rw", db.healthProfiles, db.healthLogs, db.syncQueue, async () => {
      await db.healthProfiles.clear();
      await db.healthLogs.clear();
      await db.syncQueue.clear();
    });
  });

  afterEach(cleanup);

  it("记录饮水、训练并计算 BMI", async () => {
    render(<HealthPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: "+250 ml" }));
    await waitFor(() => expect(screen.getByText("250 ml")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("本次训练次数"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "深蹲 +18 次" }));
    await waitFor(() => expect(screen.getByText("18 次")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("本次活动分钟"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "记录 8 分钟" }));
    await waitFor(() => expect(screen.getByText("8 分钟")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("身高（cm）"), { target: { value: "170" } });
    fireEvent.change(screen.getByLabelText("本次体重（kg）"), { target: { value: "65" } });
    expect(screen.getByText("22.5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(async () => expect(await db.healthProfiles.count()).toBe(1));
    await waitFor(async () => expect((await db.healthLogs.toArray()).filter((item) => item.kind === "weight")).toHaveLength(1));
  });
});
