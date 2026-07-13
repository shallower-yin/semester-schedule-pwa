import { useLiveQuery } from "dexie-react-hooks";
import { BellRing, Cake, CalendarHeart, Gift, Heart, PartyPopper, Plus, Search, Trash2 } from "lucide-react";
import type { ComponentType, CSSProperties, FormEvent, SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { db, queueChange } from "../db";
import {
  ANNIVERSARY_KIND_META,
  ANNIVERSARY_KINDS,
  anniversaryDistanceLabel,
  anniversaryKindLabel,
  anniversaryScheduleChanged,
  daysSinceAnniversary,
  daysUntilAnniversary,
  formatAnniversaryReminderBody,
  formatAnniversaryReminderLead,
  nextAnniversaryOccurrence,
  reminderPreviewText,
  yearsSinceAnniversary
} from "../lib/anniversaries";
import { formatMonthDay, toISODate } from "../lib/date";
import { hardDeleteLocalRecord } from "../lib/hardDelete";
import { syncFields } from "../lib/identity";
import { enableNotifications } from "../lib/notifications";
import { showToast } from "../lib/toast";
import type { Anniversary, AnniversaryKind } from "../types";
import { Modal } from "./Modal";

interface AnniversaryPageProps {
  ownerId: string;
  openAnniversaryId?: string | null;
  onOpenAnniversaryConsumed?: () => void;
}

type AnniversaryFilter = "all" | AnniversaryKind;
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FILTERS: Array<{ value: AnniversaryFilter; label: string; icon: IconComponent }> = [
  { value: "all", label: "全部", icon: CalendarHeart },
  { value: "anniversary", label: "纪念日", icon: Gift },
  { value: "birthday", label: "生日", icon: Cake },
  { value: "holiday", label: "节日", icon: PartyPopper }
];

const KIND_ICONS: Record<AnniversaryKind, IconComponent> = {
  anniversary: Heart,
  birthday: Cake,
  holiday: PartyPopper
};

export function AnniversaryPage({ ownerId, openAnniversaryId, onOpenAnniversaryConsumed }: AnniversaryPageProps) {
  const anniversaries = useLiveQuery(
    () => db.anniversaries.filter((item) => item.user_id === ownerId).toArray(),
    [ownerId]
  ) ?? [];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AnniversaryFilter>("all");
  const [anniversaryToEdit, setAnniversaryToEdit] = useState<Anniversary | null | undefined>(undefined);

  const activeAnniversaries = anniversaries.filter((item) => !item.deleted_at);
  useEffect(() => {
    if (!openAnniversaryId) return;
    const target = activeAnniversaries.find((item) => item.id === openAnniversaryId);
    if (!target) return;
    setAnniversaryToEdit(target);
    onOpenAnniversaryConsumed?.();
  }, [activeAnniversaries, onOpenAnniversaryConsumed, openAnniversaryId]);
  const visibleAnniversaries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeAnniversaries
      .filter((item) => filter === "all" || item.kind === filter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        return `${item.title}\n${item.note}\n${anniversaryKindLabel(item.kind)}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => {
        const leftDays = daysUntilAnniversary(left);
        const rightDays = daysUntilAnniversary(right);
        return leftDays - rightDays || left.title.localeCompare(right.title, "zh-CN");
      });
  }, [activeAnniversaries, filter, query]);

  return (
    <section className="anniversary-page">
      <aside className="memo-sidebar anniversary-sidebar">
        <div className="memo-search">
          <Search size={17} />
          <input placeholder="搜索纪念日" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="memo-sidebar-section">
          <span>展示列表</span>
          {FILTERS.map((item) => {
            const Icon = item.icon;
            const count = item.value === "all"
              ? activeAnniversaries.length
              : activeAnniversaries.filter((anniversary) => anniversary.kind === item.value).length;
            return (
              <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
                <Icon width={18} height={18} /><span>{item.label}</span><small>{count}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="anniversary-main">
        <div className="page-heading anniversary-heading">
          <div>
            <h1>纪念日</h1>
            <p>记录纪念日、生日和节日，并为每个日子单独设置提醒。</p>
          </div>
          <button className="button primary compact" onClick={() => setAnniversaryToEdit(null)}>
            <Plus size={17} />新增日子
          </button>
        </div>

        {visibleAnniversaries.length ? (
          <div className="anniversary-list" role="list" aria-label="纪念日列表">
            {visibleAnniversaries.map((anniversary) => (
              <AnniversaryCard
                key={anniversary.id}
                anniversary={anniversary}
                onEdit={setAnniversaryToEdit}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <CalendarHeart size={34} />
            <h2>{query || filter !== "all" ? "没有匹配的日子" : "还没有纪念日"}</h2>
            <p>{query || filter !== "all" ? "清空筛选后再查看全部日子。" : "先添加一个生日、纪念日或节日，再按需要设置提醒。"}</p>
            {query || filter !== "all" ? (
              <button type="button" className="button secondary compact" onClick={() => { setQuery(""); setFilter("all"); }}>清空筛选</button>
            ) : (
              <button type="button" className="button primary compact" onClick={() => setAnniversaryToEdit(null)}><Plus size={17} />添加第一个日子</button>
            )}
          </div>
        )}
      </div>

      {anniversaryToEdit !== undefined && (
        <AnniversaryDialog
          anniversary={anniversaryToEdit ?? undefined}
          initialKind={filter !== "all" ? filter : "anniversary"}
          onClose={() => setAnniversaryToEdit(undefined)}
        />
      )}
    </section>
  );
}

interface AnniversaryCardProps {
  anniversary: Anniversary;
  onEdit: (anniversary: Anniversary) => void;
}

function AnniversaryCard({ anniversary, onEdit }: AnniversaryCardProps) {
  const occurrence = nextAnniversaryOccurrence(anniversary);
  const isCountUp = anniversary.kind === "anniversary";
  const elapsedDays = daysSinceAnniversary(anniversary);
  const yearCount = yearsSinceAnniversary(anniversary, occurrence);
  const Icon = KIND_ICONS[anniversary.kind];
  return (
    <article
      className="anniversary-card"
      role="listitem"
      style={{ "--accent": anniversary.color } as CSSProperties}
      onClick={() => onEdit(anniversary)}
    >
      <div className="anniversary-card-topline">
        <span className="anniversary-kind"><Icon width={15} height={15} />{anniversaryKindLabel(anniversary.kind)}</span>
        <strong>{anniversaryDistanceLabel(anniversary)}</strong>
      </div>
      <h2>{anniversary.title}</h2>
      <div className="anniversary-card-meta">
        <span>{isCountUp ? "纪念日期" : "原始日期"}：{anniversary.date}</span>
        <span>
          {isCountUp
            ? elapsedDays >= 0
              ? `已经：${elapsedDays} 天${yearCount > 0 ? ` · 第 ${yearCount} 年` : ""}`
              : `还有：${Math.abs(elapsedDays)} 天`
            : `下次：${occurrence.getFullYear()}年${formatMonthDay(occurrence)}${yearCount > 0 && anniversary.kind !== "holiday" ? ` · 第 ${yearCount} 年` : ""}`}
        </span>
      </div>
      <p className={anniversary.reminder_enabled ? "anniversary-reminder active" : "anniversary-reminder"}>
        <BellRing size={14} />
        {anniversary.reminder_enabled
          ? `${formatAnniversaryReminderLead(anniversary.reminder_days_before)} ${anniversary.reminder_time} 提醒`
          : "不提醒"}
      </p>
      {anniversary.note && <p className="anniversary-note">{anniversary.note}</p>}
    </article>
  );
}

interface AnniversaryDialogProps {
  anniversary?: Anniversary;
  initialKind: AnniversaryKind;
  onClose: () => void;
}

function AnniversaryDialog({ anniversary, initialKind, onClose }: AnniversaryDialogProps) {
  const [kind, setKind] = useState<AnniversaryKind>(anniversary?.kind ?? initialKind);
  const [title, setTitle] = useState(anniversary?.title ?? "");
  const [date, setDate] = useState(anniversary?.date ?? toISODate(new Date()));
  const [color, setColor] = useState(anniversary?.color ?? ANNIVERSARY_KIND_META[initialKind].color);
  const [note, setNote] = useState(anniversary?.note ?? "");
  const [reminderEnabled, setReminderEnabled] = useState(anniversary?.reminder_enabled ?? false);
  const [reminderDaysBefore, setReminderDaysBefore] = useState(anniversary?.reminder_days_before ?? 0);
  const [reminderTime, setReminderTime] = useState(anniversary?.reminder_time ?? "09:00");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [enablingReminder, setEnablingReminder] = useState(false);

  const previewDraft: Anniversary = {
    id: anniversary?.id ?? "preview",
    user_id: anniversary?.user_id ?? "local",
    created_at: anniversary?.created_at ?? "",
    updated_at: anniversary?.updated_at ?? "",
    deleted_at: null,
    version: anniversary?.version ?? 0,
    device_id: anniversary?.device_id ?? "preview",
    kind,
    title: title.trim() || "未命名日子",
    date,
    color,
    note,
    reminder_enabled: reminderEnabled,
    reminder_days_before: reminderDaysBefore,
    reminder_time: reminderTime,
    reminder_sent_for: anniversary?.reminder_sent_for ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
  };
  const reminderSummary = reminderEnabled
    ? `${formatAnniversaryReminderLead(reminderDaysBefore)} ${reminderTime} 提醒，预计 ${reminderPreviewText(previewDraft)} 触发。`
    : "未开启提醒，保存后不会发送本地提醒或系统推送。";

  function changeKind(nextKind: AnniversaryKind) {
    setKind(nextKind);
    if (!anniversary) setColor(ANNIVERSARY_KIND_META[nextKind].color);
  }

  async function toggleReminder(enabled: boolean) {
    setMessage("");
    if (!enabled) {
      setReminderEnabled(false);
      return;
    }
    setReminderEnabled(true);
    setEnablingReminder(true);
    try {
      const result = await enableNotifications((stage) => {
        setMessage({
          permission: "正在检查浏览器通知权限…",
          "service-worker": "正在启动应用后台服务…",
          "push-service": "正在连接手机系统推送服务…",
          cloud: "正在保存云端推送订阅…"
        }[stage]);
      });
      if (result === "denied") {
        setReminderEnabled(false);
        setMessage("浏览器未允许通知，请在网站权限中开启后重试。");
      } else if (result === "unsupported") {
        setReminderEnabled(false);
        setMessage("当前浏览器不支持系统通知。请使用 Android Edge/Chrome 或 Windows Edge/Chrome。");
      } else if (result === "local-only") {
        setMessage("已启用提醒；登录并完成云端通知配置后，可在应用关闭时接收。");
      } else {
        setMessage("系统提醒已启用。");
      }
    } catch (error) {
      const permissionGranted = "Notification" in window && Notification.permission === "granted";
      if (!permissionGranted) setReminderEnabled(false);
      const detail = error instanceof Error ? error.message : "通知订阅失败";
      setMessage(
        permissionGranted
          ? `${detail}。纪念日仍可保存；应用打开时会进行本地提醒。`
          : `${detail}。请重新启用提醒。`
      );
    } finally {
      setEnablingReminder(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!title.trim()) {
      setMessage("请填写标题。");
      return;
    }
    if (!date) {
      setMessage("请选择日期。");
      return;
    }
    if (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 366) {
      setMessage("提前天数需要在 0 到 366 天之间。");
      return;
    }
    setSaving(true);
    const record: Anniversary = {
      ...syncFields(anniversary),
      kind,
      title: title.trim(),
      date,
      color,
      note: note.trim(),
      reminder_enabled: reminderEnabled,
      reminder_days_before: reminderDaysBefore,
      reminder_time: reminderTime,
      reminder_sent_for: anniversary?.reminder_sent_for ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    if (anniversaryScheduleChanged(anniversary, record)) {
      record.reminder_sent_for = null;
    }
    await db.anniversaries.put(record);
    await queueChange("anniversaries", record.id);
    setSaving(false);
    onClose();
  }

  async function remove() {
    if (!anniversary || !window.confirm(`确定彻底删除“${anniversary.title}”吗？该日子的提醒记录会一并删除，且无法恢复。`)) return;
    await hardDeleteLocalRecord("anniversaries", anniversary.id);
    showToast("日子已彻底删除。", "success");
    onClose();
  }

  return (
    <Modal title={anniversary ? "编辑日子" : "新增日子"} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <div className="form-grid">
          <label>类型
            <select value={kind} onChange={(event) => changeKind(event.target.value as AnniversaryKind)}>
              {ANNIVERSARY_KINDS.map((item) => <option key={item} value={item}>{anniversaryKindLabel(item)}</option>)}
            </select>
          </label>
          <label>颜色<input className="color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        </div>
        <label>标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>日期<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <section className="reminder-editor anniversary-reminder-editor">
          <label className="checkbox-label">
            <input type="checkbox" checked={reminderEnabled} onChange={(event) => void toggleReminder(event.target.checked)} />
            <BellRing size={17} />提醒我
          </label>
          {reminderEnabled && (
            <div className="form-grid anniversary-reminder-grid">
              <label>提前天数<input type="number" min={0} max={366} value={reminderDaysBefore} onChange={(event) => setReminderDaysBefore(Number(event.target.value))} /></label>
              <label>提醒时间<input required type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /></label>
            </div>
          )}
          <p className={reminderEnabled ? "reminder-status active" : "reminder-status"}>
            <strong>{reminderEnabled ? "提醒已开启" : "提醒未开启"}</strong>
            <span>{reminderSummary}</span>
          </p>
          {reminderEnabled && (
            <p className="form-hint">
              {formatAnniversaryReminderBody(previewDraft, nextAnniversaryOccurrence(previewDraft))}
            </p>
          )}
        </section>
        <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {message && <p className={message.includes("失败") || message.includes("请") || message.includes("不支持") ? "auth-message error" : "auth-message"}>{message}</p>}
        <div className="form-actions split">
          <div>{anniversary && <button type="button" className="button danger-button" onClick={() => void remove()}><Trash2 size={16} />彻底删除</button>}</div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button className="button primary" disabled={saving || enablingReminder}>
              {saving ? "保存中…" : enablingReminder ? "正在启用提醒…" : "保存"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
