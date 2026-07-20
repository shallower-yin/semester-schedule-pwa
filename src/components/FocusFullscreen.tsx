import { useMemo, useState } from "react";
import { CheckCircle2, Images, Pause, PictureInPicture2, Play, Shrink, Square } from "lucide-react";
import { focusModeLabel, formatFocusDuration, type ActiveFocusState } from "../lib/focus";

// Bundled night-scene backgrounds (public/focus). WebP so they stay small and are precached offline.
const FOCUS_BACKGROUNDS = [
  `${import.meta.env.BASE_URL}focus/focus-bg-1.webp`,
  `${import.meta.env.BASE_URL}focus/focus-bg-2.webp`,
  `${import.meta.env.BASE_URL}focus/focus-bg-3.webp`,
  `${import.meta.env.BASE_URL}focus/focus-bg-4.webp`
];

const FOCUS_QUOTES = [
  "专注当下，一次只做一件事。",
  "把时间留给真正重要的事。",
  "静下心来，效率自然会来。",
  "每一次专注，都在靠近目标。",
  "慢就是快，稳就是赢。"
];

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function formatFocusDate(now: Date): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
}

interface FocusFullscreenProps {
  active: ActiveFocusState;
  displaySeconds: number;
  progress: number;
  paused: boolean;
  now: Date;
  systemWindowSupported: boolean;
  onPauseResume: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  onExit: () => void;
  onOpenSystemWindow: () => void;
}

export function FocusFullscreen({
  active,
  displaySeconds,
  progress,
  paused,
  now,
  systemWindowSupported,
  onPauseResume,
  onFinish,
  onDiscard,
  onExit,
  onOpenSystemWindow
}: FocusFullscreenProps) {
  const [bgIndex, setBgIndex] = useState(() => Math.floor(Math.random() * FOCUS_BACKGROUNDS.length));
  const quote = useMemo(() => FOCUS_QUOTES[Math.floor(Math.random() * FOCUS_QUOTES.length)], []);
  const dateText = formatFocusDate(now);

  return (
    <div
      className="focus-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="全屏专注"
      style={{ backgroundImage: `url("${FOCUS_BACKGROUNDS[bgIndex]}")` }}
    >
      <div className="focus-fullscreen-scrim" />
      <div className="focus-fullscreen-top">
        <button type="button" className="focus-fs-icon" onClick={onExit} aria-label="退出全屏" title="退出全屏">
          <Shrink size={20} />
        </button>
        <button
          type="button"
          className="focus-fs-icon"
          onClick={() => setBgIndex((index) => (index + 1) % FOCUS_BACKGROUNDS.length)}
          aria-label="切换背景"
          title="切换背景"
        >
          <Images size={20} />
        </button>
      </div>

      <div className="focus-fullscreen-body">
        <span className="focus-fs-label">{paused ? "已暂停" : focusModeLabel(active.mode)}</span>
        <div className="focus-fs-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}>
          <strong className="focus-fs-time">{formatFocusDuration(displaySeconds)}</strong>
        </div>
        {active.task_title && <p className="focus-fs-task">{active.task_title}</p>}
        <p className="focus-fs-date">{dateText}</p>
        <p className="focus-fs-quote">{quote}</p>
      </div>

      <div className="focus-fullscreen-actions">
        {systemWindowSupported && (
          <button type="button" className="button ghost-light" onClick={onOpenSystemWindow} title="在其他应用上方显示倒计时">
            <PictureInPicture2 size={17} />系统小窗
          </button>
        )}
        <button type="button" className="button ghost-light" onClick={onPauseResume}>
          {paused ? <Play size={17} /> : <Pause size={17} />}{paused ? "继续" : "暂停"}
        </button>
        <button type="button" className="button primary" onClick={onFinish}>
          <CheckCircle2 size={17} />结束并保存
        </button>
        <button type="button" className="button ghost-light danger" onClick={onDiscard}>
          <Square size={16} />放弃
        </button>
      </div>
    </div>
  );
}
