import { CalendarDays, ChevronRight } from "lucide-react";
import { useState } from "react";
import { isNativeApp } from "../lib/nativeApp";
import { requestScheduleWidgetPin } from "../lib/scheduleWidgetPlugin";
import { showToast } from "../lib/toast";

export function ScheduleWidgetSettingCard() {
  const [requesting, setRequesting] = useState(false);
  if (!isNativeApp()) return null;

  async function addWidget() {
    if (requesting) return;
    setRequesting(true);
    try {
      const result = await requestScheduleWidgetPin();
      if (result.requested) {
        showToast("已打开系统添加面板，请确认“添加到主屏幕”。", "success");
      } else if (!result.supported) {
        showToast("当前桌面不支持应用内添加，请长按桌面空白处，在“小组件”中选择“日程计划表”。", "info");
      } else {
        showToast("系统未能打开添加面板，请长按桌面空白处手动添加。", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法打开桌面组件添加面板，请稍后重试。", "error");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <button className="setting-card" disabled={requesting} onClick={() => void addWidget()}>
      <CalendarDays />
      <span>
        <strong>{requesting ? "正在打开系统面板…" : "添加桌面组件"}</strong>
        <small>在桌面同时查看今日日程和待办，并分别快速进入对应页面</small>
      </span>
      <ChevronRight />
    </button>
  );
}
