import { CalendarDays, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, formatMonthDay, parseLocalDate, startOfWeek, toISODate, weekDates } from "../lib/date";
import { buildSnapshotDays, exportScheduleSnapshot, type ScheduleSnapshotInput } from "../lib/scheduleSnapshot";
import type { ThemeSkinId } from "../lib/themeSkins";
import { Modal } from "./Modal";

interface ScheduleSnapshotDialogProps {
  mode: "day" | "week";
  input: ScheduleSnapshotInput;
  skinId: ThemeSkinId;
  onClose: () => void;
}

type DayChoice = "today" | "tomorrow" | "specific";
type WeekChoice = "current" | "next" | "semester";

export function ScheduleSnapshotDialog({ mode, input, skinId, onClose }: ScheduleSnapshotDialogProps) {
  const today = useMemo(() => new Date(), []);
  const [dayChoice, setDayChoice] = useState<DayChoice>("today");
  const [weekChoice, setWeekChoice] = useState<WeekChoice>("current");
  const [specificDate, setSpecificDate] = useState(toISODate(today));
  const currentSemesterWeek = input.semester ? Math.max(1, Math.min(input.semester.total_weeks, Math.floor((startOfWeek(today).getTime() - parseLocalDate(input.semester.start_date).getTime()) / 604800000) + 1)) : 1;
  const [semesterWeek, setSemesterWeek] = useState(currentSemesterWeek);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  function targetDates(): Date[] {
    if (mode === "day") {
      if (dayChoice === "tomorrow") return [addDays(today, 1)];
      if (dayChoice === "specific") return [parseLocalDate(specificDate)];
      return [today];
    }
    if (weekChoice === "next") return weekDates(addDays(today, 7));
    if (weekChoice === "semester" && input.semester) return weekDates(addDays(parseLocalDate(input.semester.start_date), (semesterWeek - 1) * 7));
    return weekDates(today);
  }

  async function exportSnapshot() {
    setExporting(true);
    setErrorMessage("");
    try {
      const dates = targetDates();
      const days = buildSnapshotDays(input, dates);
      const title = mode === "day" ? `${formatMonthDay(dates[0])} 日程` : `${formatMonthDay(dates[0])} - ${formatMonthDay(dates[6])} 周日程`;
      const fileName = mode === "day" ? `日快照-${toISODate(dates[0])}` : `周快照-${toISODate(dates[0])}`;
      await exportScheduleSnapshot({ mode, days, skinId, title, fileName });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "快照生成失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal title={mode === "day" ? "导出日快照" : "导出周快照"} onClose={onClose}>
      <div className="snapshot-dialog">
        <div className="snapshot-choice-grid">
          {mode === "day" ? <>
            <button className={dayChoice === "today" ? "active" : ""} onClick={() => setDayChoice("today")}><strong>今日快照</strong><span>{formatMonthDay(today)}</span></button>
            <button className={dayChoice === "tomorrow" ? "active" : ""} onClick={() => setDayChoice("tomorrow")}><strong>明日快照</strong><span>{formatMonthDay(addDays(today, 1))}</span></button>
            <button className={dayChoice === "specific" ? "active" : ""} onClick={() => setDayChoice("specific")}><strong>指定日期</strong><span>选择任意一天</span></button>
          </> : <>
            <button className={weekChoice === "current" ? "active" : ""} onClick={() => setWeekChoice("current")}><strong>本周快照</strong><span>当前自然周</span></button>
            <button className={weekChoice === "next" ? "active" : ""} onClick={() => setWeekChoice("next")}><strong>下周快照</strong><span>下一自然周</span></button>
            <button disabled={!input.semester} className={weekChoice === "semester" ? "active" : ""} onClick={() => setWeekChoice("semester")}><strong>特定周数</strong><span>{input.semester ? `当前约第 ${currentSemesterWeek} 周` : "需要先创建学期"}</span></button>
          </>}
        </div>
        {mode === "day" && dayChoice === "specific" && <label>指定日期<input type="date" value={specificDate} onChange={(event) => setSpecificDate(event.target.value)} /></label>}
        {mode === "week" && weekChoice === "semester" && input.semester && <label>选择教学周<select value={semesterWeek} onChange={(event) => setSemesterWeek(Number(event.target.value))}>{Array.from({ length: input.semester.total_weeks }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 周</option>)}</select></label>}
        <div className="snapshot-preview-note"><CalendarDays size={18} /><span>导出 PNG 图片，课程、事项、地点和完成状态会按所选日期重新计算，配色跟随当前皮肤。</span></div>
        {errorMessage && <p className="auth-message error" role="alert">{errorMessage}</p>}
        <div className="form-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={exporting} onClick={() => void exportSnapshot()}><Download size={17} />{exporting ? "生成中" : "导出快照"}</button></div>
      </div>
    </Modal>
  );
}
