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
    expect(screen.getAllByText("22.5")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(async () => expect(await db.healthProfiles.count()).toBe(1));
    await waitFor(async () => expect((await db.healthLogs.toArray()).filter((item) => item.kind === "weight")).toHaveLength(1));
  });

  it("可以依次撤销当天最近的活动与训练记录", async () => {
    render(<HealthPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: "深蹲 +10 次" }));
    await waitFor(() => expect(screen.getByText("10 次")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "记录 5 分钟" }));
    await waitFor(() => expect(screen.getByText("5 分钟")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "撤销最近一次活动或训练" }));
    await waitFor(async () => {
      const active = (await db.healthLogs.toArray()).filter((item) => !item.deleted_at);
      expect(active.map((item) => item.kind)).toEqual(["exercise"]);
    });
    await waitFor(() => expect(screen.getByText("0 分钟")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "撤销最近一次活动或训练" }));
    await waitFor(async () => {
      const active = (await db.healthLogs.toArray()).filter((item) => !item.deleted_at);
      expect(active).toHaveLength(0);
    });
  });

  it("可以增减训练项目并随健康设置保存", async () => {
    render(<HealthPage ownerId="local" />);

    fireEvent.click(screen.getByRole("button", { name: "增减训练项目" }));
    fireEvent.change(screen.getByLabelText("新训练项目名称"), { target: { value: "平板支撑" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "删除俯卧撑" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    expect(screen.getByRole("button", { name: "平板支撑 +10 次" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "俯卧撑 +10 次" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(async () => {
      const saved = await db.healthProfiles.where("user_id").equals("local").first();
      expect(saved?.exercise_items).toEqual(["仰卧起坐", "深蹲", "平板支撑"]);
    });
  });
});
