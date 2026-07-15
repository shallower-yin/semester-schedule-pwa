import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { loadActiveFocus, saveActiveFocus, type ActiveFocusState } from "../lib/focus";
import { setCurrentUserId } from "../lib/identity";
import { completeExpiredFocus } from "./FocusFloatingTimer";

describe("全局专注倒计时", () => {
  beforeEach(async () => {
    localStorage.clear();
    setCurrentUserId("local");
    await db.focusSessions.clear();
    await db.focusSettings.clear();
    await db.syncQueue.clear();
  });

  it("离开专注页后仍能在到点时结算并清除计时器", async () => {
    const active: ActiveFocusState = {
      mode: "countdown",
      task_title: "复习高数",
      linked_event_id: null,
      planned_seconds: 60,
      started_at: "2026-07-15T08:00:00.000Z",
      paused_seconds: 0,
      pause_started_at: null
    };
    saveActiveFocus("local", active);

    expect(await completeExpiredFocus("local", active, new Date("2026-07-15T08:01:05.000Z"))).toBe(true);
    expect(loadActiveFocus("local")).toBeNull();
    expect(await db.focusSessions.count()).toBe(1);
    expect(await db.syncQueue.where("table_name").equals("focusSessions").count()).toBe(1);
  });
});
