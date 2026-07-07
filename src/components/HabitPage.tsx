import { BarChart3, Bell, CalendarCheck, CheckCircle2, Flame, Plus } from "lucide-react";
import { useMemo } from "react";
import { db, queueChange } from "../db";
import { toISODate } from "../lib/date";
import { buildEventCompletionRecord, eventCompletionForDate } from "../lib/eventCompletion";
import { buildHabitStats, isHabit } from "../lib/habits";
import type { EventItem, EventOccurrenceState } from "../types";

interface HabitPageProps {
  habits: EventItem[];
  occurrenceStates: EventOccurrenceState[];
  onAddHabit: () => void;
  onEditHabit: (habit: EventItem) => void;
}

export function HabitPage({ habits, occurrenceStates, onAddHabit, onEditHabit }: HabitPageProps) {
  const visibleHabits = useMemo(
    () => habits.filter((habit) => isHabit(habit) && !habit.deleted_at),
    [habits]
  );
  const statsByHabit = useMemo(
    () => new Map(visibleHabits.map((habit) => [habit.id, buildHabitStats(habit, occurrenceStates)])),
    [occurrenceStates, visibleHabits]
  );
  const totalScheduled = Array.from(statsByHabit.values()).reduce((sum, stats) => sum + stats.totalScheduled, 0);
  const totalCompleted = Array.from(statsByHabit.values()).reduce((sum, stats) => sum + stats.completed, 0);
  const todayPending = Array.from(statsByHabit.values()).filter((stats) => stats.todayOccurs && !stats.todayCompleted).length;
  const bestStreak = Math.max(0, ...Array.from(statsByHabit.values()).map((stats) => stats.currentStreak));
  const completionRate = totalScheduled ? Math.round((totalCompleted / totalScheduled) * 100) : 0;
  const sortedHabits = [...visibleHabits].sort((left, right) => {
    const leftStats = statsByHabit.get(left.id);
    const rightStats = statsByHabit.get(right.id);
    const leftPending = leftStats?.todayOccurs && !leftStats.todayCompleted ? 0 : 1;
    const rightPending = rightStats?.todayOccurs && !rightStats.todayCompleted ? 0 : 1;
    return leftPending - rightPending || left.title.localeCompare(right.title, "zh-CN");
  });

  return (
    <section className="habit-page">
      <div className="page-heading habit-heading">
        <div>
          <h1>习惯</h1>
          <p>按日期范围每天打卡，可设置提醒，并查看完成率和连续记录。</p>
        </div>
        <button className="button primary compact" onClick={onAddHabit}><Plus size={17} />新增习惯</button>
      </div>

      <div className="habit-stats">
        <article><BarChart3 /><span><strong>{completionRate}%</strong><small>总完成率</small></span></article>
        <article><CalendarCheck /><span><strong>{todayPending}</strong><small>今日待打卡</small></span></article>
        <article><Flame /><span><strong>{bestStreak}</strong><small>最长当前连续</small></span></article>
      </div>

      {sortedHabits.length ? (
        <div className="habit-list" role="list" aria-label="习惯列表">
          {sortedHabits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              stats={statsByHabit.get(habit.id)!}
              occurrenceStates={occurrenceStates}
              onEdit={onEditHabit}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <CheckCircle2 size={34} />
          <h2>还没有习惯</h2>
          <p>新增一个习惯，设置一段日期范围和提醒时间，然后每天打卡。</p>
        </div>
      )}
    </section>
  );
}

interface HabitCardProps {
  habit: EventItem;
  stats: ReturnType<typeof buildHabitStats>;
  occurrenceStates: EventOccurrenceState[];
  onEdit: (habit: EventItem) => void;
}

function HabitCard({ habit, stats, occurrenceStates, onEdit }: HabitCardProps) {
  async function toggleToday(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!stats.todayOccurs) return;
    const completion = eventCompletionForDate(habit, occurrenceStates, new Date());
    const record = buildEventCompletionRecord(habit, completion.occurrenceDate, !completion.completed, completion.state);
    await db.eventOccurrenceStates.put(record);
    await queueChange("eventOccurrenceStates", record.id);
  }

  return (
    <article className="habit-card" role="listitem" onClick={() => onEdit(habit)}>
      <div className="habit-card-main">
        <span className={stats.todayCompleted ? "habit-check done" : "habit-check"}>
          <CheckCircle2 size={18} />
        </span>
        <div>
          <h2>{habit.title}</h2>
          <p>{habit.start_date} 至 {habit.recurrence_type === "weekly" ? habit.recurrence_until ?? habit.end_date : habit.end_date}</p>
          <div className="habit-meta">
            <span>{habit.all_day ? "全天" : `${habit.start_time ?? "09:00"}–${habit.end_time ?? habit.start_time ?? "09:00"}`}</span>
            {habit.reminder_enabled && <span><Bell size={13} />提前 {habit.reminder_minutes_before} 分钟</span>}
          </div>
        </div>
      </div>
      <div className="habit-progress">
        <span><strong>{stats.completed}</strong> / {stats.totalScheduled || 0}</span>
        <div><i style={{ width: `${stats.completionRate}%` }} /></div>
        <small>完成率 {stats.completionRate}% · 连续 {stats.currentStreak} 天</small>
      </div>
      <button
        type="button"
        className={stats.todayCompleted ? "button secondary compact" : "button primary compact"}
        disabled={!stats.todayOccurs}
        onClick={(event) => void toggleToday(event)}
      >
        {stats.todayOccurs ? stats.todayCompleted ? "取消今日打卡" : "今日打卡" : `今天 ${toISODate(new Date())} 不需要打卡`}
      </button>
    </article>
  );
}
