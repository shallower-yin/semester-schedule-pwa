import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleWidgetSettingCard } from "./ScheduleWidgetSettingCard";

const mocks = vi.hoisted(() => ({
  native: true,
  requestPin: vi.fn(),
  showToast: vi.fn()
}));

vi.mock("../lib/nativeApp", () => ({ isNativeApp: () => mocks.native }));
vi.mock("../lib/scheduleWidgetPlugin", () => ({ requestScheduleWidgetPin: mocks.requestPin }));
vi.mock("../lib/toast", () => ({ showToast: mocks.showToast }));

describe("桌面组件设置入口", () => {
  beforeEach(() => {
    mocks.native = true;
    mocks.requestPin.mockReset();
    mocks.showToast.mockReset();
  });
  afterEach(cleanup);

  it("仅在 Android APK 中显示，并请求系统添加组件", async () => {
    mocks.requestPin.mockResolvedValue({ supported: true, requested: true });
    render(<ScheduleWidgetSettingCard />);

    fireEvent.click(screen.getByRole("button", { name: /添加桌面组件/ }));

    await waitFor(() => expect(mocks.requestPin).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("添加到主屏幕"), "success");
  });

  it("桌面不支持应用内添加时提示手动添加", async () => {
    mocks.requestPin.mockResolvedValue({ supported: false, requested: false });
    render(<ScheduleWidgetSettingCard />);

    fireEvent.click(screen.getByRole("button", { name: /添加桌面组件/ }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("长按桌面空白处"), "info"));
  });

  it("网页和 PWA 不显示 Android 专属入口", () => {
    mocks.native = false;
    render(<ScheduleWidgetSettingCard />);
    expect(screen.queryByRole("button", { name: /添加桌面组件/ })).not.toBeInTheDocument();
  });
});
