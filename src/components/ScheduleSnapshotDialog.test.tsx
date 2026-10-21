import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportScheduleSnapshot, type ScheduleSnapshotInput } from "../lib/scheduleSnapshot";
import { ScheduleSnapshotDialog } from "./ScheduleSnapshotDialog";

vi.mock("../lib/scheduleSnapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/scheduleSnapshot")>(),
  exportScheduleSnapshot: vi.fn(async () => undefined)
}));

const input: ScheduleSnapshotInput = { semester: null, courses: [], schedules: [], cancellations: [], events: [], categories: [], occurrenceStates: [], periods: [] };

describe("快照导出布局选择", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(exportScheduleSnapshot).mockClear();
  });

  it.each([{ mobile: true, layout: "mobile" }, { mobile: false, layout: "desktop" }])("根据导出时的屏幕宽度选择 $layout 周快照", async ({ mobile, layout }) => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(max-width: 900px)" && mobile } as MediaQueryList));
    const close = vi.fn();
    render(<ScheduleSnapshotDialog mode="week" input={input} skinId="default" onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "导出快照" }));
    await waitFor(() => expect(exportScheduleSnapshot).toHaveBeenCalledWith(expect.objectContaining({ mode: "week", layout, days: expect.any(Array) })));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
