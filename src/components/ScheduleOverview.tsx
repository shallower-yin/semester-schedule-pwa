import { BookOpen, CalendarCheck2, CheckCircle2, Clock3, Target } from "lucide-react";
import { formatFocusDuration } from "../lib/focus";
import type { ScheduleOverview } from "../lib/overview";

interface ScheduleOverviewProps {
  overview: ScheduleOverview;
  onOpenFocus: () => void;
}

export function ScheduleOverviewPanel({ overview, onOpenFocus }: ScheduleOverviewProps) {
  return (
    <section className="schedule-overview" aria-label="今日和本周概览">
      <div className="overview-stat primary-stat">
        <CalendarCheck2 size={20} />
        <span>
          <strong>{overview.todayItemCount}</strong>
          <small>今日安排</small>
        </span>
      </div>
      <div className="overview-stat">
        <CheckCircle2 size={19} />
        <span>
          <strong>{overview.todayIncompleteEventCount}</strong>
          <small>今日未完成</small>
        </span>
      </div>
      <div className="overview-stat">
        <Target size={19} />
        <span>
          <strong>{formatFocusDuration(overview.weekFocusSeconds)}</strong>
          <small>本周专注</small>
        </span>
      </div>
      <div className="overview-stat">
        <BookOpen size={19} />
        <span>
          <strong>{overview.todayCourseCount}</strong>
          <small>今日课程</small>
        </span>
      </div>
      <div className="overview-list">
        <div className="overview-list-header">
          <span>今天</span>
          <button type="button" onClick={onOpenFocus}>去专注</button>
        </div>
        {overview.upcomingItems.length ? (
          overview.upcomingItems.map((item) => (
            <div key={`${item.type}-${item.id}`} className={`overview-item ${item.completed ? "completed" : ""}`}>
              <i style={{ background: item.color }} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <em><Clock3 size={12} />{item.timeLabel}</em>
            </div>
          ))
        ) : (
          <p className="overview-empty">今天暂无安排。</p>
        )}
      </div>
    </section>
  );
}
