import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  GraduationCap,
  LogIn,
  Menu,
  NotebookText,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Target,
  UserRound,
  WifiOff,
  X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AccountDialog } from "./components/AccountDialog";
import { AddScheduleDialog } from "./components/AddScheduleDialog";
import { AuthDialog } from "./components/AuthDialog";
import { BackupDialog } from "./components/BackupDialog";
import { CourseDialog } from "./components/CourseDialog";
import { CourseManagerDialog } from "./components/CourseManagerDialog";
import { EventDialog } from "./components/EventDialog";
import { FocusPage } from "./components/FocusPage";
import { InstallDialog } from "./components/InstallDialog";
import { MemoPage } from "./components/MemoPage";
import { PeriodSettingsDialog } from "./components/PeriodSettingsDialog";
import { ScheduleOverviewPanel } from "./components/ScheduleOverview";
import { SemesterDialog } from "./components/SemesterDialog";
import { SchoolTimetableImportDialog } from "./components/SchoolTimetableImportDialog";
import { WeekCalendar } from "./components/WeekCalendar";
import { db, queueChange } from "./db";
import {
  addDays,
  formatWeekRange,
  semesterWeekForDate,
  startOfWeek,
  toISODate,
  weekDates
} from "./lib/date";
import { uniqueCategoriesByName } from "./lib/categories";
import type { EventStatusFilter } from "./lib/eventStatusFilter";
import { setCurrentUserId, syncFields } from "./lib/identity";
import { checkDueLocalReminders, enableNotifications } from "./lib/notifications";
import { buildScheduleOverview, type ScheduleOverviewItem } from "./lib/overview";
import {
  clearCapturedInstallPrompt,
  getCapturedInstallPrompt,
  PWA_INSTALL_AVAILABLE_EVENT,
  type BeforeInstallPromptEvent
} from "./lib/pwaInstall";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { adoptAnonymousData, getLastSync, pullRemoteNow, syncNow, type SyncResult } from "./lib/sync";
import type { Course, EventItem, Semester } from "./types";

type Page = "calendar" | "memos" | "focus" | "settings";
type ScheduleFilter = "all" | "courses" | "uncategorized" | string;

interface EventDraft {
  date: string;
  start: string;
  end: string;
  allDay: boolean;
}

export default function App() {
  const appVersion = __APP_VERSION__;
  const [page, setPage] = useState<Page>("calendar");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [overviewNow, setOverviewNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [semesterToEdit, setSemesterToEdit] = useState<Semester | null | undefined>(undefined);
  const [showPeriodSettings, setShowPeriodSettings] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [courseToEdit, setCourseToEdit] = useState<Course | null | undefined>(undefined);
  const [eventToEdit, setEventToEdit] = useState<EventItem | null | undefined>(undefined);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [showCourseManager, setShowCourseManager] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<"login" | "recovery" | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getCapturedInstallPrompt());
  const [installed, setInstalled] = useState(() => window.matchMedia("(display-mode: standalone)").matches);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showSchoolImport, setShowSchoolImport] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("all");
  const ownerId = user?.id ?? "local";

  const semester = useLiveQuery(
    () => db.semesters.filter((item) => item.user_id === ownerId && item.is_current && !item.deleted_at).first(),
    [ownerId]
  );
  const semesters = useLiveQuery(
    () => db.semesters.filter((item) => item.user_id === ownerId && !item.deleted_at).reverse().sortBy("start_date"),
    [ownerId]
  ) ?? [];
  const courses = useLiveQuery(
    () => (semester ? db.courses.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray() : []),
    [semester?.id, ownerId]
  ) ?? [];
  const schedules = useLiveQuery(
    async () => {
      if (!courses.length) return [];
      const courseIds = new Set(courses.map((course) => course.id));
      return db.courseSchedules.filter((item) => item.user_id === ownerId && courseIds.has(item.course_id) && !item.deleted_at).toArray();
    },
    [courses.map((course) => course.id).join(","), ownerId]
  ) ?? [];
  const cancellations = useLiveQuery(() => db.courseCancellations.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const events = useLiveQuery(() => db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const categories = uniqueCategoriesByName(
    useLiveQuery(
      () => db.categories.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(),
      [ownerId]
    ) ?? []
  );
  const occurrenceStates = useLiveQuery(() => db.eventOccurrenceStates.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const focusSessions = useLiveQuery(() => db.focusSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const periods = useLiveQuery(
    () => (semester ? db.classPeriods.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray() : []),
    [semester?.id, ownerId]
  ) ?? [];
  const pendingChanges = useLiveQuery(() => db.syncQueue.count(), []) ?? 0;

  const dates = useMemo(() => weekDates(anchorDate), [anchorDate]);
  const weekNumber = semester ? semesterWeekForDate(semester, dates[0]) : null;
  const scheduleOverview = useMemo(
    () => semester
      ? buildScheduleOverview({
        semester,
        courses,
        schedules,
        cancellations,
        events,
        categories,
        occurrenceStates,
        periods,
        focusSessions
      }, overviewNow)
      : null,
    [categories, cancellations, courses, events, focusSessions, occurrenceStates, overviewNow, periods, schedules, semester]
  );
  const filteredCourses = useMemo(() => {
    const query = scheduleQuery.trim().toLowerCase();
    if (eventStatusFilter !== "all") return [];
    if (scheduleFilter !== "all" && scheduleFilter !== "courses") return [];
    if (!query) return courses;
    return courses.filter((course) =>
      [course.name, course.teacher, course.classroom, course.note].join("\n").toLowerCase().includes(query)
    );
  }, [courses, eventStatusFilter, scheduleFilter, scheduleQuery]);
  const filteredEvents = useMemo(() => {
    const query = scheduleQuery.trim().toLowerCase();
    return events.filter((eventItem) => {
      if (scheduleFilter === "courses") return false;
      if (scheduleFilter === "uncategorized" && eventItem.category_id) return false;
      if (scheduleFilter !== "all" && scheduleFilter !== "uncategorized" && eventItem.category_id !== scheduleFilter) return false;
      if (!query) return true;
      const category = categories.find((item) => item.id === eventItem.category_id);
      return [eventItem.title, eventItem.note, category?.name ?? ""].join("\n").toLowerCase().includes(query);
    });
  }, [categories, events, scheduleFilter, scheduleQuery]);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW();

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setCurrentUserId(data.session?.user.id ?? null);
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setCurrentUserId(session?.user.id ?? null);
      setUser(session?.user ?? null);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") setAuthDialogMode("recovery");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const captureInstallPrompt = () => setInstallPrompt(getCapturedInstallPrompt());
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstallMessage("安装完成。Windows 通常会把应用加入开始菜单；桌面图标是否自动创建由浏览器设置决定。");
    };
    captureInstallPrompt();
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setLastSync(null);
      return;
    }
    let active = true;
    setLastSync(getLastSync(user.id));
    async function bootstrapSync() {
      setSyncing(true);
      try {
        const adopted = await adoptAnonymousData(user!.id);
        const result = await syncNow(user!.id);
        if (!active) return;
        setLastSync(result.completed_at);
        setSyncMessage(adopted ? `已接管 ${adopted} 条本地数据并完成同步。` : "同步完成。");
      } catch (error) {
        if (active) setSyncMessage(error instanceof Error ? error.message : "同步失败");
      } finally {
        if (active) setSyncing(false);
      }
    }
    void bootstrapSync();
    const syncWhenOnline = () => void handleSync();
    window.addEventListener("online", syncWhenOnline);
    return () => {
      active = false;
      window.removeEventListener("online", syncWhenOnline);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || pendingChanges === 0 || !navigator.onLine) return;
    const timer = window.setTimeout(() => void handleSync(), 1500);
    return () => window.clearTimeout(timer);
  }, [user?.id, pendingChanges]);

  useEffect(() => {
    const check = () => void checkDueLocalReminders(ownerId);
    check();
    const timer = window.setInterval(check, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ownerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setOverviewNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || !("Notification" in window) || Notification.permission !== "granted") return;
    void enableNotifications().catch(() => {
      // “账号与同步”窗口会显示可操作的通知诊断信息。
    });
  }, [user?.id]);

  async function handleSync(): Promise<SyncResult | void> {
    if (!user) {
      setAuthDialogMode("login");
      return;
    }
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await syncNow(user.id);
      setLastSync(result.completed_at);
      setSyncMessage(`同步完成：上传 ${result.uploaded} 条，下载 ${result.downloaded} 条。`);
      return result;
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePullRemote(): Promise<SyncResult | void> {
    if (!user) {
      setAuthDialogMode("login");
      return;
    }
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await pullRemoteNow(user.id);
      setLastSync(result.completed_at);
      setSyncMessage(`已重新拉取云端：下载 ${result.downloaded} 条。`);
      return result;
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "拉取云端失败");
    } finally {
      setSyncing(false);
    }
  }

  async function requestInstall() {
    if (!installPrompt || installing) return;
    setInstalling(true);
    setInstallMessage("");
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      clearCapturedInstallPrompt();
      setInstallPrompt(null);
      setInstallMessage(
        choice.outcome === "accepted"
          ? "已确认安装。请在 Windows 开始菜单或手机桌面查找“日程计划表”；Windows 不一定自动创建桌面图标。"
          : "安装已取消。可以再次打开本窗口，按照下方浏览器菜单步骤安装。"
      );
    } finally {
      setInstalling(false);
    }
  }

  async function applyAppUpdate() {
    if (updatingApp) return;
    setUpdatingApp(true);
    setUpdateMessage("正在切换到新版本…");
    let reloaded = false;
    let fallbackTimer: number | null = null;

    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    const handleControllerChange = () => {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      reloadOnce();
    };

    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange, { once: true });
        fallbackTimer = window.setTimeout(reloadOnce, 3000);
      } else {
        fallbackTimer = window.setTimeout(reloadOnce, 500);
      }
      await updateServiceWorker(true);
    } catch (error) {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      }
      setUpdatingApp(false);
      setUpdateMessage(error instanceof Error ? `更新失败：${error.message}` : "更新失败，请稍后重试。");
    }
  }

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setSidebarOpen(false);
  }

  function moveWeek(amount: number) {
    setAnchorDate((current) => addDays(current, amount * 7));
  }

  function goToday() {
    setAnchorDate(new Date());
    setSelectedDay((new Date().getDay() + 6) % 7);
  }

  function moveMobileDay(direction: number, nextSelectedDay: number) {
    setAnchorDate((current) => addDays(current, direction * 7));
    setSelectedDay(nextSelectedDay);
  }

  function openNewEvent(date: string, start: string, end: string, allDay = false) {
    setEventDraft({ date, start, end, allDay });
    setEventToEdit(null);
  }

  function openOverviewItem(item: ScheduleOverviewItem) {
    if (item.type === "course") {
      const course = courses.find((candidate) => candidate.id === item.targetId);
      if (course) setCourseToEdit(course);
      return;
    }
    const eventItem = events.find((candidate) => candidate.id === item.targetId);
    if (eventItem) setEventToEdit(eventItem);
  }

  async function activateSemester(target: Semester) {
    if (target.is_current) return;
    await db.transaction("rw", db.semesters, db.syncQueue, async () => {
      for (const item of semesters) {
        const shouldBeCurrent = item.id === target.id;
        if (item.is_current === shouldBeCurrent) continue;
        const updated = { ...item, ...syncFields(item), is_current: shouldBeCurrent };
        await db.semesters.put(updated);
        await queueChange("semesters", updated.id);
      }
    });
    setPage("calendar");
    setAnchorDate(new Date());
  }

  const navigation = (
    <>
      <button className={page === "calendar" ? "active" : ""} onClick={() => navigate("calendar")}><CalendarDays size={19} />日程</button>
      <button className={page === "memos" ? "active" : ""} onClick={() => navigate("memos")}><NotebookText size={19} />备忘录</button>
      <button className={page === "focus" ? "active" : ""} onClick={() => navigate("focus")}><Target size={19} />专注</button>
      <button className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} />设置</button>
    </>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开菜单"><Menu /></button>
          <div className="brand-mark"><CalendarDays size={23} /></div>
          <div>
            <strong>日程计划表</strong>
            <span>{semester?.name ?? "尚未创建学期"}</span>
          </div>
        </div>
        <nav className="desktop-nav">{navigation}</nav>
        <div className="header-status">
          <button className={`sync-status ${user ? "connected" : ""}`} onClick={() => user ? setShowAccount(true) : setAuthDialogMode("login")}>
            {user ? <Cloud size={16} /> : <LogIn size={16} />}
            <span>
              {!authReady ? "正在检查账号…" :
                syncing ? "正在同步…" :
                user ? `${user.email} · ${pendingChanges} 项待同步` :
                supabaseConfigured ? "登录并同步" :
                `仅本地 · ${pendingChanges} 项待同步`}
            </span>
          </button>
        </div>
      </header>

      {sidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={() => setSidebarOpen(false)}>
          <aside className="mobile-sidebar" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sidebar-header"><strong>菜单</strong><button className="icon-button" onClick={() => setSidebarOpen(false)}><X /></button></div>
            <nav>{navigation}</nav>
          </aside>
        </div>
      )}

      <main>
        {!semester && page !== "memos" && page !== "focus" ? (
          <section className="empty-state welcome-state">
            <div className="empty-icon"><GraduationCap size={34} /></div>
            <h1>先建立你的学期</h1>
            <p>设置开学日期和周数后，就能添加课程、每日节次和普通事项。</p>
            <button className="button primary" onClick={() => setSemesterToEdit(null)}><Plus size={18} />创建学期</button>
          </section>
        ) : page === "memos" ? (
          <MemoPage ownerId={ownerId} />
        ) : page === "focus" ? (
          <FocusPage ownerId={ownerId} />
        ) : page === "calendar" ? (
          <>
            <section className="calendar-toolbar">
              <div>
                <div className="week-title">
                  <h1>{weekNumber ? `第 ${weekNumber} 周` : "学期外日期"}</h1>
                  <span>{formatWeekRange(dates)}</span>
                </div>
              </div>
              <div className="toolbar-actions">
                <button className="button secondary compact" onClick={() => moveWeek(-1)} aria-label="上一周"><ChevronLeft size={18} /><span>上一周</span></button>
                <button className="button secondary compact" onClick={goToday}>回到本周</button>
                <button className="button secondary compact" onClick={() => moveWeek(1)} aria-label="下一周"><span>下一周</span><ChevronRight size={18} /></button>
                <button className="button secondary compact" onClick={() => setShowCourseManager(true)}><BookOpen size={18} />课程管理</button>
                <button className="button primary compact" onClick={() => setShowAddSchedule(true)}><Plus size={18} />新增日程</button>
              </div>
            </section>
            {scheduleOverview && (
              <ScheduleOverviewPanel
                overview={scheduleOverview}
                onOpenFocus={() => navigate("focus")}
                onOpenItem={openOverviewItem}
                onShowIncomplete={() => {
                  goToday();
                  setScheduleFilter("all");
                  setEventStatusFilter("incomplete");
                  setScheduleQuery("");
                }}
              />
            )}
            <section className="schedule-filter-bar" aria-label="日程搜索和筛选">
              <input
                value={scheduleQuery}
                onChange={(event) => setScheduleQuery(event.target.value)}
                placeholder="搜索课程、事项、教师、教室或备注"
              />
              <select value={scheduleFilter} onChange={(event) => setScheduleFilter(event.target.value)}>
                <option value="all">全部日程</option>
                <option value="courses">只看课程</option>
                <option value="uncategorized">未分类事项</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <select value={eventStatusFilter} onChange={(event) => setEventStatusFilter(event.target.value as EventStatusFilter)}>
                <option value="all">全部状态</option>
                <option value="incomplete">未完成事项</option>
                <option value="completed">已完成事项</option>
              </select>
              {(scheduleQuery || scheduleFilter !== "all" || eventStatusFilter !== "all") && (
                <button className="button secondary compact" onClick={() => {
                  setScheduleQuery("");
                  setScheduleFilter("all");
                  setEventStatusFilter("all");
                }}>
                  清除筛选
                </button>
              )}
            </section>
            <WeekCalendar
              dates={dates}
              semester={semester!}
              courses={filteredCourses}
              schedules={schedules}
              cancellations={cancellations}
              events={filteredEvents}
              eventStatusFilter={eventStatusFilter}
              categories={categories}
              occurrenceStates={occurrenceStates}
              periods={periods}
              selectedDay={selectedDay}
              onSelectedDayChange={setSelectedDay}
              onMoveMobileWeek={moveMobileDay}
              onAddEvent={openNewEvent}
              onEditEvent={(item) => setEventToEdit(item)}
              onEditCourse={(item) => setCourseToEdit(item)}
            />
          </>
        ) : (
          <section className="content-page">
            <div className="page-heading"><div><h1>设置</h1><p>管理学期作息、本地数据和同步准备状态。</p></div></div>
            <div className="settings-grid">
              <button className="setting-card" onClick={() => setShowInstallDialog(true)}>
                <Download /><span><strong>安装到设备</strong><small>{installed ? "已安装，可从桌面或主屏幕打开" : "安装为独立应用，并按引导创建快捷方式"}</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => needRefresh ? void applyAppUpdate() : window.location.reload()} disabled={updatingApp}>
                <RefreshCw /><span><strong>应用版本</strong><small>{appVersion} · {updatingApp ? updateMessage : needRefresh ? "有新版本，点击更新" : "点击重新加载并检查更新"}</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => setSemesterToEdit(semester)}>
                <GraduationCap /><span><strong>当前学期</strong><small>{semester!.name} · {semester!.total_weeks} 周</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => setShowPeriodSettings(true)}>
                <SlidersHorizontal /><span><strong>每日时间块设置</strong><small>自由添加、删除和排序节次或午休</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => setShowBackup(true)}>
                <Database /><span><strong>JSON 数据备份</strong><small>导入或导出本地数据</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => setShowSchoolImport(true)}>
                <FileSpreadsheet /><span><strong>天津大学课表提取器</strong><small>提取学校导出的 HTML-XLS 课表</small></span><ChevronRight />
              </button>
              <button className="setting-card" onClick={() => user ? setShowAccount(true) : setAuthDialogMode("login")}>
                {user ? <UserRound /> : <WifiOff />}<span><strong>账号与云同步</strong><small>{user ? user.email : "登录后在手机与电脑间同步"}</small></span><ChevronRight />
              </button>
            </div>
            <div className="local-data-card">
              <Download size={22} />
              <div><strong>本地优先已启用</strong><p>课程和事项会立即保存到 IndexedDB。当前有 {pendingChanges} 条本地变更{user ? "等待上传" : "，登录后可上传"}。</p></div>
            </div>
            <section className="semester-manager">
              <div className="section-heading">
                <div><h3>学期列表</h3><p>切换学期不会删除其他学期的数据。</p></div>
                <button className="button secondary compact" onClick={() => setSemesterToEdit(null)}><Plus size={16} />新建学期</button>
              </div>
              <div className="semester-list">
                {semesters.map((item) => (
                  <button key={item.id} className={item.is_current ? "active" : ""} onClick={() => void activateSemester(item)}>
                    <span><strong>{item.name}</strong><small>{item.start_date} · {item.total_weeks} 周</small></span>
                    <span>{item.is_current ? "当前" : "切换"}</span>
                  </button>
                ))}
              </div>
            </section>
          </section>
        )}
      </main>

      <nav className="mobile-bottom-nav" aria-label="手机底部导航">{navigation}</nav>
      {page === "calendar" && semester && (
        <button className="mobile-fab" onClick={() => setShowAddSchedule(true)} aria-label="新增日程">
          <Plus size={26} />
        </button>
      )}

      {semesterToEdit !== undefined && <SemesterDialog semester={semesterToEdit ?? undefined} onClose={() => setSemesterToEdit(undefined)} />}
      {showPeriodSettings && <PeriodSettingsDialog semester={semester!} onClose={() => setShowPeriodSettings(false)} />}
      {showBackup && <BackupDialog onClose={() => setShowBackup(false)} />}
      {showSchoolImport && <SchoolTimetableImportDialog semester={semester!} onClose={() => setShowSchoolImport(false)} />}
      {showInstallDialog && (
        <InstallDialog
          installed={installed}
          promptAvailable={Boolean(installPrompt)}
          message={installMessage}
          installing={installing}
          onInstall={requestInstall}
          onClose={() => setShowInstallDialog(false)}
        />
      )}
      {showAddSchedule && (
        <AddScheduleDialog
          onAddCourse={() => {
            setShowAddSchedule(false);
            setCourseToEdit(null);
          }}
          onAddEvent={() => {
            setShowAddSchedule(false);
            openNewEvent(toISODate(dates[selectedDay]), "09:00", "10:00");
          }}
          onClose={() => setShowAddSchedule(false)}
        />
      )}
      {showCourseManager && (
        <CourseManagerDialog
          courses={courses}
          schedules={schedules}
          onAdd={() => {
            setShowCourseManager(false);
            setCourseToEdit(null);
          }}
          onEdit={(course) => {
            setShowCourseManager(false);
            setCourseToEdit(course);
          }}
          onClose={() => setShowCourseManager(false)}
        />
      )}
      {authDialogMode && <AuthDialog initialMode={authDialogMode} onClose={() => setAuthDialogMode(null)} />}
      {showAccount && user && (
        <AccountDialog
          user={user}
          pendingChanges={pendingChanges}
          lastSync={lastSync}
          syncing={syncing}
          message={syncMessage}
          onSync={handleSync}
          onPullRemote={handlePullRemote}
          onClose={() => setShowAccount(false)}
        />
      )}
      {courseToEdit !== undefined && <CourseDialog semester={semester!} course={courseToEdit ?? undefined} onClose={() => setCourseToEdit(undefined)} />}
      {(eventDraft || eventToEdit !== undefined) && (
        <EventDialog
          eventItem={eventToEdit ?? undefined}
          initialDate={eventToEdit?.start_date ?? eventDraft?.date ?? toISODate(new Date())}
          initialStartTime={eventDraft?.start}
          initialEndTime={eventDraft?.end}
          initialAllDay={eventDraft?.allDay}
          ownerId={ownerId}
          occurrenceStates={occurrenceStates}
          onClose={() => {
            setEventDraft(null);
            setEventToEdit(undefined);
          }}
        />
      )}

      {needRefresh && (
        <div className="update-toast">
          <RefreshCw size={18} />
          <span>{updatingApp ? updateMessage : `新版本已准备好 · 当前 ${appVersion}`}</span>
          <button disabled={updatingApp} onClick={() => void applyAppUpdate()}>{updatingApp ? "更新中…" : "立即更新"}</button>
          <button className="icon-button" onClick={() => setNeedRefresh(false)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
