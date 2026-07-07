import { AlertCircle, BookOpen, CalendarCheck2, CheckCircle2, Clock3, Percent, Target, TrendingUp } from "lucide-react";
import { formatFocusDuration } from "../lib/focus";
import type { ScheduleOverview, ScheduleOverviewItem } from "../lib/overview";

interface ScheduleOverviewProps {
  overview: ScheduleOverview;
  onOpenFocus: () => void;
  onOpenItem: (item: ScheduleOverviewItem) => void;
  onShowIncomplete: () => void;
}

export function ScheduleOverviewPanel({ overview, onOpenFocus, onOpenItem, onShowIncomplete }: ScheduleOverviewProps) {
  const maxTrendSeconds = Math.max(1, ...overview.weekFocusTrend.map((day) => day.totalSeconds));

  return (
    <section className="schedule-overview" aria-label="今日和本周概览">
      <div className="overview-stat primary-stat">
        <CalendarCheck2 size={20} />
        <span>
          <strong>{overview.todayItemCount}</strong>
          <small>今日安排</small>
        </span>
      </div>
      <button type="button" className="overview-stat overview-stat-button" onClick={onShowIncomplete}>
        <CheckCircle2 size={19} />
        <span>
          <strong>{overview.todayIncompleteEventCount}</strong>
          <small>今日未完成</small>
        </span>
      </button>
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
      <div className="overview-stat">
        <Percent size={19} />
        <span>
          <strong>{overview.weekCompletionRate}%</strong>
          <small>本周完成率</small>
        </span>
      </div>
      <button type="button" className="overview-stat overview-stat-button" onClick={onShowIncomplete}>
        <AlertCircle size={19} />
        <span>
          <strong>{overview.overdueIncompleteItems.length}</strong>
          <small>逾期未完成</small>
        </span>
      </button>
      <div className="overview-list">
        <div className="overview-list-header">
          <span>今天</span>
          <button type="button" onClick={onOpenFocus}>去专注</button>
        </div>
        {overview.upcomingItems.length ? (
          overview.upcomingItems.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              className={`overview-item ${item.completed ? "completed" : ""}`}
              onClick={() => onOpenItem(item)}
            >
              <i style={{ background: item.color }} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <em><Clock3 size={12} />{item.timeLabel}</em>
            </button>
          ))
        ) : (
          <p className="overview-empty">今天暂无安排。</p>
        )}
      </div>
      <div className="overview-list">
        <div className="overview-list-header">
          <span>逾期未完成</span>
          <button type="button" onClick={onShowIncomplete}>查看</button>
        </div>
        {overview.overdueIncompleteItems.length ? (
          overview.overdueIncompleteItems.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              className="overview-item overdue"
              onClick={() => onOpenItem(item)}
            >
              <i style={{ background: item.color }} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <em><Clock3 size={12} />{item.timeLabel}</em>
            </button>
          ))
        ) : (
          <p className="overview-empty">最近没有逾期未完成事项。</p>
        )}
      </div>
      <div className="overview-trend">
        <div className="overview-list-header">
          <span><TrendingUp size={15} />本周专注趋势</span>
          <button type="button" onClick={onOpenFocus}>详情</button>
        </div>
        <div className="overview-trend-bars">
          {overview.weekFocusTrend.map((item) => {
            return (
              <div key={item.date} className={item.isToday ? "today" : ""}>
                <span><i style={{ height: `${Math.max(6, (item.totalSeconds / maxTrendSeconds) * 100)}%` }} /></span>
                <strong>{formatFocusDuration(item.totalSeconds)}</strong>
                <small>{item.label}</small>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
