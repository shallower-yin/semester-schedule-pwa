import { useLiveQuery } from "dexie-react-hooks";
import {
  Bot,
  BookOpen,
  BrainCircuit,
  CalendarCheck2,
  CalendarHeart,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Palette,
  Target,
  Trash2,
  UserRound,
  WifiOff,
  X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AccountDialog } from "./components/AccountDialog";
import { AdminDialog } from "./components/AdminDialog";
import { AddScheduleDialog } from "./components/AddScheduleDialog";
import { AnniversaryPage } from "./components/AnniversaryPage";
import { AuthDialog } from "./components/AuthDialog";
import { BackupDialog } from "./components/BackupDialog";
import { BatchEventsDialog } from "./components/BatchEventsDialog";
import { CourseDialog } from "./components/CourseDialog";
import { CourseManagerDialog } from "./components/CourseManagerDialog";
import { DataHealthDialog } from "./components/DataHealthDialog";
import { DeepSeekAssistantDialog } from "./components/DeepSeekAssistantDialog";
import { EventDialog } from "./components/EventDialog";
import { FocusPage } from "./components/FocusPage";
import { GlobalSearchDialog, type GlobalSearchResult } from "./components/GlobalSearchDialog";
import { HabitPage } from "./components/HabitPage";
import { HeaderToolSettingsDialog } from "./components/HeaderToolSettingsDialog";
import { HelpPage } from "./components/HelpPage";
import { InstallDialog } from "./components/InstallDialog";
import { MemoPage } from "./components/MemoPage";
import { MobileNavSettingsDialog } from "./components/MobileNavSettingsDialog";
import { PeriodSettingsDialog } from "./components/PeriodSettingsDialog";
import { QuickEntryDialog } from "./components/QuickEntryDialog";
import { ScheduleAssistantDialog } from "./components/ScheduleAssistantDialog";
import { SemesterDialog } from "./components/SemesterDialog";
import { SchoolTimetableImportDialog } from "./components/SchoolTimetableImportDialog";
import { StatsDialog } from "./components/StatsDialog";
import { ThemeSkinDialog } from "./components/ThemeSkinDialog";
import { TodayPage } from "./components/TodayPage";
import { ToastHost } from "./components/ToastHost";
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
import { deleteSemesterCascade } from "./lib/semesters";
import { checkDueLocalReminders, enableNotifications } from "./lib/notifications";
import { loadHeaderToolSettings, type HeaderToolId } from "./lib/headerToolSettings";
import { loadMobileNavSettings } from "./lib/mobileNavSettings";
import { loadThemeSkin, themeSkinLabel, type ThemeSkinId } from "./lib/themeSkins";
import { getAdminStatus } from "./lib/admin";
import { buildScheduleOverview, type ScheduleOverviewItem } from "./lib/overview";
import { BACKUP_STATUS_CHANGED_EVENT, getLastBackupAt } from "./lib/backupStatus";
import { showToast } from "./lib/toast";
import {
  clearCapturedInstallPrompt,
  getCapturedInstallPrompt,
  PWA_INSTALL_AVAILABLE_EVENT,
  type BeforeInstallPromptEvent
} from "./lib/pwaInstall";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { adoptAnonymousData, getLastSync, pullRemoteNow, syncNow, type SyncResult } from "./lib/sync";
import type { Anniversary, Course, EventItem, EventType, Memo, PageId, Semester } from "./types";

type Page = PageId;
type ScheduleFilter = "all" | "courses" | "uncategorized" | string;

interface EventDraft {
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  eventType: EventType;
}

function formatSyncDateTime(value: string | null): string {
  if (!value) return "暂无同步记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无同步记录";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatBackupDateTime(value: string | null): string {
  if (!value) return "尚未导出备份";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未导出备份";
  return `上次导出 ${date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })}`;
}

export default function App() {
  const appVersion = `版本 ${__APP_VERSION__} · 提交 ${__APP_COMMIT__}`;
  const [page, setPage] = useState<Page>("today");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [overviewNow, setOverviewNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [semesterToEdit, setSemesterToEdit] = useState<Semester | null | undefined>(undefined);
  const [showPeriodSettings, setShowPeriodSettings] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showBatchEvents, setShowBatchEvents] = useState(false);
  const [showDataHealth, setShowDataHealth] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [showScheduleAssistant, setShowScheduleAssistant] = useState(false);
  const [showDeepSeekAssistant, setShowDeepSeekAssistant] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMobileNavSettings, setShowMobileNavSettings] = useState(false);
  const [showHeaderToolSettings, setShowHeaderToolSettings] = useState(false);
  const [showThemeSkinSettings, setShowThemeSkinSettings] = useState(false);
  const [themeSkin, setThemeSkin] = useState<ThemeSkinId>(() => loadThemeSkin());
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
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => getLastBackupAt());
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getCapturedInstallPrompt());
  const [installed, setInstalled] = useState(() => window.matchMedia("(display-mode: standalone)").matches);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showSchoolImport, setShowSchoolImport] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [anniversaryToOpen, setAnniversaryToOpen] = useState<string | null>(null);
  const [memoToOpen, setMemoToOpen] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [mobileNavItems, setMobileNavItems] = useState<PageId[]>(() => loadMobileNavSettings());
  const [headerToolItems, setHeaderToolItems] = useState<HeaderToolId[]>(() => loadHeaderToolSettings());
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("all");
  const [isAdmin, setIsAdmin] = useState(false);
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
  const anniversaries = useLiveQuery(() => db.anniversaries.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const memos = useLiveQuery(() => db.memos.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const focusSessions = useLiveQuery(() => db.focusSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray(), [ownerId]) ?? [];
  const periods = useLiveQuery(
    () => (semester ? db.classPeriods.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray() : []),
    [semester?.id, ownerId]
  ) ?? [];
  const pendingChanges = useLiveQuery(() => db.syncQueue.count(), []) ?? 0;

  const dates = useMemo(() => weekDates(anchorDate), [anchorDate]);
  const weekNumber = semester ? semesterWeekForDate(semester, dates[0]) : null;
  const todayOverview = useMemo(
    () => buildScheduleOverview({
        semester,
        courses,
        schedules,
        cancellations,
        events,
        categories,
        occurrenceStates,
        periods,
        focusSessions,
        maxItems: 50
      }, overviewNow),
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
    if (!user || !supabase) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    async function loadAdminFlag() {
      const status = await getAdminStatus().catch(() => null);
      if (!active) return;
      setIsAdmin(Boolean(status?.isAdmin));
    }
    void loadAdminFlag();
    return () => {
      active = false;
    };
  }, [user?.id]);

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
    const refreshBackupStatus = () => setLastBackupAt(getLastBackupAt());
    window.addEventListener(BACKUP_STATUS_CHANGED_EVENT, refreshBackupStatus);
    window.addEventListener("storage", refreshBackupStatus);
    return () => {
      window.removeEventListener(BACKUP_STATUS_CHANGED_EVENT, refreshBackupStatus);
      window.removeEventListener("storage", refreshBackupStatus);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "/") {
        event.preventDefault();
        setShowGlobalSearch(true);
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewEvent(toISODate(new Date()), "09:00", "10:00");
      } else if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        setShowQuickEntry(true);
      } else if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setShowScheduleAssistant(true);
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        setShowDeepSeekAssistant(true);
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        goToday();
        setPage("today");
      } else if (event.key === "Escape") {
        setShowGlobalSearch(false);
        setShowAddSchedule(false);
        setShowBatchEvents(false);
        setShowDataHealth(false);
        setShowStats(false);
        setShowScheduleAssistant(false);
        setShowDeepSeekAssistant(false);
        setShowAdmin(false);
        setShowHeaderToolSettings(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [semester]);

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
      showToast(`同步完成：上传 ${result.uploaded} 条，下载 ${result.downloaded} 条。`, "success");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      setSyncMessage(message);
      showToast(message, "error");
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
      showToast(`已重新拉取云端：下载 ${result.downloaded} 条。`, "success");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "拉取云端失败";
      setSyncMessage(message);
      showToast(message, "error");
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
    setUpdateMessage("正在通知后台服务安装新版本…");
    let reloaded = false;
    let fallbackTimer: number | null = null;

    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    const handleControllerChange = () => {
      setUpdateMessage("新版本已接管，正在刷新页面…");
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      reloadOnce();
    };

    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange, { once: true });
        setUpdateMessage("正在等待新版本接管页面…");
        fallbackTimer = window.setTimeout(reloadOnce, 3000);
      } else {
        setUpdateMessage("当前浏览器没有后台服务，正在直接刷新…");
        fallbackTimer = window.setTimeout(reloadOnce, 500);
      }
      await updateServiceWorker(true);
    } catch (error) {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      }
      setUpdatingApp(false);
      const message = error instanceof Error ? `更新失败：${error.message}` : "更新失败，请稍后重试。";
      setUpdateMessage(message);
      showToast(message, "error");
    }
  }

  async function hardReloadApp() {
    setUpdatingApp(true);
    setUpdateMessage("正在清理缓存并重新加载…");
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } finally {
      window.location.replace(`${window.location.pathname}?reload=${Date.now()}${window.location.hash}`);
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

  function openNewEvent(date: string, start: string, end: string, allDay = false, eventType: EventType = "event") {
    setEventDraft({ date, start, end, allDay, eventType });
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

  function openGlobalSearchResult(result: GlobalSearchResult) {
    setShowGlobalSearch(false);
    if (result.type === "course") {
      const course = courses.find((candidate) => candidate.id === result.id);
      if (course) {
        setCourseToEdit(course);
        setPage("calendar");
      }
      return;
    }
    if (result.type === "event") {
      const eventItem = events.find((candidate) => candidate.id === result.id);
      if (eventItem) {
        setEventToEdit(eventItem);
        setPage(eventItem.event_type === "habit" ? "habits" : "calendar");
      }
      return;
    }
    if (result.type === "anniversary") {
      setAnniversaryToOpen(result.id);
      setPage("anniversaries");
      return;
    }
    setMemoToOpen(result.id);
    setPage("memos");
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

  async function deleteSemester(target: Semester) {
    const confirmed = window.confirm(`确定彻底删除“${target.name}”吗？该学期下的课程、节次、课程安排和停课标记会一并删除；普通事项、习惯、纪念日和备忘录不受影响。`);
    if (!confirmed) return;
    await deleteSemesterCascade(target.id);
    if (semester?.id === target.id) setAnchorDate(new Date());
  }

  const navItems: Array<{ id: PageId; label: string; icon: ReactNode }> = [
    { id: "today", label: "今天", icon: <CalendarCheck2 size={19} /> },
    { id: "calendar", label: "日程", icon: <CalendarDays size={19} /> },
    { id: "habits", label: "习惯", icon: <CheckCircle2 size={19} /> },
    { id: "anniversaries", label: "纪念日", icon: <CalendarHeart size={19} /> },
    { id: "memos", label: "备忘录", icon: <NotebookText size={19} /> },
    { id: "focus", label: "专注", icon: <Target size={19} /> },
    { id: "settings", label: "设置", icon: <Settings size={19} /> },
    { id: "help", label: "使用说明", icon: <CircleHelp size={19} /> }
  ];
  const selectedMobileNavItems = navItems
    .filter((item) => mobileNavItems.includes(item.id))
    .sort((left, right) => mobileNavItems.indexOf(left.id) - mobileNavItems.indexOf(right.id));
  const lastBackupText = formatBackupDateTime(lastBackupAt);
  const syncSummary = useMemo(() => {
    const pendingText = pendingChanges > 0 ? `${pendingChanges} 条本地变更待同步` : "暂无待上传数据";
    const hasSyncError = Boolean(syncMessage && !/完成|重新拉取|已接管/.test(syncMessage));
    if (!authReady) {
      return {
        tone: "neutral",
        state: "checking",
        title: "正在检查账号",
        detail: "本地数据照常可用，正在确认当前登录状态。"
      };
    }
    if (!supabaseConfigured) {
      return {
        tone: "warning",
        state: "local",
        title: "仅本地使用",
        detail: `云端同步未配置，数据会保存在当前设备。${pendingText}。`
      };
    }
    if (!user) {
      return {
        tone: "warning",
        state: "signed-out",
        title: "未登录同步账号",
        detail: `本地保存正常，登录后可在手机和电脑间同步。${pendingText}。`
      };
    }
    if (syncing) {
      return {
        tone: "neutral",
        state: "syncing",
        title: "正在同步",
        detail: `${user.email} · 正在上传和拉取云端数据。`
      };
    }
    if (hasSyncError) {
      return {
        tone: "warning",
        state: "error",
        title: "同步失败",
        detail: `${user.email} · ${syncMessage || "请重试或重新拉取云端。"}`
      };
    }
    if (pendingChanges > 0) {
      return {
        tone: "warning",
        state: "pending",
        title: "待同步",
        detail: `${user.email} · ${pendingText}。`
      };
    }
    return {
      tone: "success",
      state: "synced",
      title: "已同步",
      detail: `${user.email} · 上次同步 ${formatSyncDateTime(lastSync)}。`
    };
  }, [authReady, lastSync, pendingChanges, syncMessage, syncing, user]);
  const headerTools: Array<{ id: HeaderToolId; label: string; node: ReactNode }> = [
    {
      id: "account",
      label: "账号同步",
      node: (
        <button className={`sync-status ${user ? "connected" : ""}`} onClick={() => user ? setShowAccount(true) : setAuthDialogMode("login")} aria-label="账号同步">
          {user ? <Cloud size={16} /> : <LogIn size={16} />}
          <span>
            {!authReady ? "正在检查账号…" :
              syncing ? "正在同步…" :
              user ? `${user.email} · ${syncSummary.title}${pendingChanges > 0 ? ` ${pendingChanges} 项` : ""}` :
              supabaseConfigured ? "登录并同步" :
              `仅本地 · ${pendingChanges} 项待同步`}
          </span>
        </button>
      )
    },
    {
      id: "scheduleAssistant",
      label: "日程助手",
      node: <button className="icon-button header-search-button" onClick={() => setShowScheduleAssistant(true)} aria-label="日程助手"><Bot size={18} /></button>
    },
    {
      id: "aiAssistant",
      label: "AI 助手",
      node: <button className="icon-button header-search-button" onClick={() => setShowDeepSeekAssistant(true)} aria-label="AI 助手"><BrainCircuit size={18} /></button>
    },
    {
      id: "quickEntry",
      label: "快速录入",
      node: <button className="icon-button header-search-button" onClick={() => setShowQuickEntry(true)} aria-label="快速录入"><Sparkles size={18} /></button>
    },
    {
      id: "search",
      label: "全局搜索",
      node: <button className="icon-button header-search-button" onClick={() => setShowGlobalSearch(true)} aria-label="全局搜索"><Search size={18} /></button>
    }
  ];
  const selectedHeaderTools = headerTools
    .filter((item) => headerToolItems.includes(item.id))
    .sort((left, right) => headerToolItems.indexOf(left.id) - headerToolItems.indexOf(right.id));

  function renderSettingsSection(title: string, description: string, children: ReactNode) {
    return (
      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="settings-grid">{children}</div>
      </section>
    );
  }

  function renderNavigation(items: typeof navItems) {
    return items.map((item) => (
      <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
        {item.icon}{item.label}
      </button>
    ));
  }

  return (
    <div className="app-shell" data-skin={themeSkin}>
      <header className="app-header">
        <div className="brand">
          <button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开菜单"><Menu /></button>
          <div className="brand-mark"><CalendarDays size={23} /></div>
          <div>
            <strong>日程计划表</strong>
            <span>{semester?.name ?? "个人日程"}</span>
          </div>
        </div>
        <nav className="desktop-nav">{renderNavigation(navItems)}</nav>
        <div className="header-status">
          {selectedHeaderTools.map((tool) => <span key={tool.id} className="header-tool">{tool.node}</span>)}
        </div>
      </header>

      {sidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={() => setSidebarOpen(false)}>
          <aside className="mobile-sidebar" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sidebar-header"><strong>菜单</strong><button className="icon-button" onClick={() => setSidebarOpen(false)}><X /></button></div>
            <nav>{renderNavigation(navItems)}</nav>
          </aside>
        </div>
      )}

      <main>
        {page === "memos" ? (
          <MemoPage ownerId={ownerId} openMemoId={memoToOpen} onOpenMemoConsumed={() => setMemoToOpen(null)} />
        ) : page === "anniversaries" ? (
          <AnniversaryPage ownerId={ownerId} openAnniversaryId={anniversaryToOpen} onOpenAnniversaryConsumed={() => setAnniversaryToOpen(null)} />
        ) : page === "habits" ? (
          <HabitPage
            habits={events}
            occurrenceStates={occurrenceStates}
            onAddHabit={() => openNewEvent(toISODate(new Date()), "09:00", "09:10", false, "habit")}
            onEditHabit={(habit) => setEventToEdit(habit)}
          />
        ) : page === "focus" ? (
          <FocusPage ownerId={ownerId} />
        ) : page === "help" ? (
          <HelpPage />
        ) : page === "today" && todayOverview ? (
          <TodayPage
            overview={todayOverview}
            anniversaries={anniversaries}
            events={events}
            occurrenceStates={occurrenceStates}
            onOpenItem={openOverviewItem}
            onOpenAnniversary={(id) => {
              setAnniversaryToOpen(id);
              navigate("anniversaries");
            }}
            onOpenFocus={() => navigate("focus")}
            onAddEvent={openNewEvent}
            onQuickEntry={() => setShowQuickEntry(true)}
            onCreateSemester={() => setSemesterToEdit(null)}
            hasSemesters={semesters.length > 0}
          />
        ) : page === "calendar" ? (
          <>
            <section className="calendar-toolbar">
              <div>
                <div className="week-title">
                  <h1>{semester ? (weekNumber ? `第 ${weekNumber} 周` : "学期外日期") : "本周"}</h1>
                  <span>{formatWeekRange(dates)}</span>
                </div>
              </div>
              <div className="toolbar-actions">
                <button className="button secondary compact" onClick={() => moveWeek(-1)} aria-label="上一周"><ChevronLeft size={18} /><span>上一周</span></button>
                <button className="button secondary compact" onClick={goToday}>回到本周</button>
                <button className="button secondary compact" onClick={() => moveWeek(1)} aria-label="下一周"><span>下一周</span><ChevronRight size={18} /></button>
                <button className="button secondary compact" onClick={() => semester ? setShowCourseManager(true) : setSemesterToEdit(null)}><BookOpen size={18} />课程管理</button>
                <button className="button secondary compact" onClick={() => setShowBatchEvents(true)}>批量事项</button>
                <button className="button primary compact" onClick={() => setShowAddSchedule(true)}><Plus size={18} />新增日程</button>
              </div>
            </section>
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
              semester={semester}
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
            <div className="page-heading"><div><h1>设置</h1><p>管理账号同步、数据备份、界面设置和可选学生功能。</p></div></div>
            <div className="settings-sections">
              {renderSettingsSection("常用", "账号、版本、皮肤和备份放在最容易找到的位置。", (
                <>
                  <button className="setting-card" onClick={() => user ? setShowAccount(true) : setAuthDialogMode("login")}>
                    {user ? <UserRound /> : <WifiOff />}<span><strong>账号与云同步</strong><small>{user ? user.email : "登录后在手机与电脑间同步"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => needRefresh ? void applyAppUpdate() : window.location.reload()} disabled={updatingApp}>
                    <RefreshCw /><span><strong>应用版本</strong><small>{appVersion} · {updatingApp ? updateMessage : needRefresh ? "有新版本，点击更新" : "点击重新加载并检查更新"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowBackup(true)}>
                    <Database /><span><strong>数据备份</strong><small>{lastBackupText}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowThemeSkinSettings(true)}>
                    <Palette /><span><strong>界面皮肤</strong><small>{themeSkinLabel(themeSkin)} · 切换可爱或简洁风格</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowInstallDialog(true)}>
                    <Download /><span><strong>安装到设备</strong><small>{installed ? "已安装，可从桌面或主屏幕打开" : "安装为独立应用，并按引导创建快捷方式"}</small></span><ChevronRight />
                  </button>
                </>
              ))}
              {renderSettingsSection("日程", "普通事项不依赖学期；课程、节次和课表导入属于可选学生功能。", (
                <>
                  <button className="setting-card" onClick={() => setSemesterToEdit(semester ?? null)}>
                    <GraduationCap /><span><strong>学期设置（可选）</strong><small>{semester ? `${semester.name} · ${semester.total_weeks} 周` : "不创建也能使用普通日程；学生课程功能可在这里开启"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => semester ? setShowPeriodSettings(true) : setSemesterToEdit(null)}>
                    <SlidersHorizontal /><span><strong>每日时间块设置</strong><small>{semester ? "自由添加、删除和排序节次或午休" : "创建学期后可自定义课程节次；普通日程会使用默认时间网格"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => semester ? setShowStats(true) : navigate("focus")}>
                    <Target /><span><strong>统计与日历导出</strong><small>{semester ? "查看完成率、专注趋势，并导出 ICS" : "无学期时可先在专注页查看专注统计"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => semester ? setShowSchoolImport(true) : setSemesterToEdit(null)}>
                    <FileSpreadsheet /><span><strong>天津大学课表提取器</strong><small>{semester ? "提取学校导出的 HTML-XLS 课表" : "需要先创建学期，用于保存课程周数和节次"}</small></span><ChevronRight />
                  </button>
                </>
              ))}
              {renderSettingsSection("高级", "辅助分析、界面入口和维护功能集中放置，减少日常页面干扰。", (
                <>
                  <button className="setting-card" onClick={() => setShowScheduleAssistant(true)}>
                    <Bot /><span><strong>日程助手</strong><small>本地回答今天安排、未完成、课程教室、冲突和统计</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowDeepSeekAssistant(true)}>
                    <BrainCircuit /><span><strong>AI 助手</strong><small>智能分析日程安排，可按账号或访问口令控制使用权限</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowDataHealth(true)}>
                    <Database /><span><strong>数据健康检查</strong><small>检查同步、重复分类和异常事项</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowMobileNavSettings(true)}>
                    <SlidersHorizontal /><span><strong>底部按钮设置</strong><small>自定义手机底部显示哪几个入口和顺序</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowHeaderToolSettings(true)}>
                    <SlidersHorizontal /><span><strong>顶部按钮设置</strong><small>自定义顶部显示哪些工具和顺序</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => void hardReloadApp()} disabled={updatingApp}>
                    <RefreshCw /><span><strong>清缓存重载</strong><small>手机 PWA 更新没生效时使用，会重新获取最新资源</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => user ? setShowAdmin(true) : setAuthDialogMode("login")}>
                    <ShieldCheck /><span><strong>管理后台</strong><small>{isAdmin ? "查看账号数据概览，管理 AI 助手和管理员权限" : "登录后可查看账号权限与管理功能"}</small></span><ChevronRight />
                  </button>
                </>
              ))}
            </div>
            <div className={`local-data-card sync-summary-card ${syncSummary.tone}`}>
              {!supabaseConfigured ? <WifiOff size={22} /> : user ? <Cloud size={22} /> : <LogIn size={22} />}
              <div>
                <strong>{syncSummary.title}</strong>
                <p>{syncSummary.detail}</p>
              </div>
              <div className="sync-summary-actions">
                {syncSummary.state === "error" && user ? (
                  <>
                    <button className="button secondary compact" onClick={() => void handleSync()} disabled={syncing || !authReady}>
                      <RefreshCw size={16} />重试
                    </button>
                    <button className="button secondary compact" onClick={() => void handlePullRemote()} disabled={syncing || !authReady}>
                      重新拉取云端
                    </button>
                    <button className="button secondary compact" onClick={() => setShowBackup(true)}>
                      导出备份
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button secondary compact" onClick={() => user ? void handleSync() : setAuthDialogMode("login")} disabled={syncing || !authReady}>
                      <RefreshCw size={16} />{user ? "立即同步" : "登录同步"}
                    </button>
                    <button className="button secondary compact" onClick={() => user ? setShowAccount(true) : setAuthDialogMode("login")}>
                      详情
                    </button>
                  </>
                )}
              </div>
            </div>
            <section className="semester-manager">
              <div className="section-heading">
                <div><h3>学期列表（可选）</h3><p>学期只用于课程、节次和课表导入；不创建也能使用普通事项、习惯、纪念日和备忘录。</p></div>
                <button className="button secondary compact" onClick={() => setSemesterToEdit(null)}><Plus size={16} />新建学期</button>
              </div>
              <div className="semester-list">
                {semesters.map((item) => (
                  <div key={item.id} className={`semester-list-row ${item.is_current ? "active" : ""}`}>
                    <button className="semester-list-main" onClick={() => void activateSemester(item)}>
                      <span><strong>{item.name}</strong><small>{item.start_date} · {item.total_weeks} 周</small></span>
                      <span>{item.is_current ? "当前" : "切换"}</span>
                    </button>
                    <div className="semester-list-actions">
                      <button type="button" className="icon-button" aria-label={`编辑${item.name}`} onClick={() => setSemesterToEdit(item)}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="icon-button danger" aria-label={`删除${item.name}`} onClick={() => void deleteSemester(item)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                {!semesters.length && <p className="muted-note">暂无学期。非学生用户可以忽略这里，直接在日程里添加事项。</p>}
              </div>
            </section>
          </section>
        )}
      </main>

      <nav className="mobile-bottom-nav" aria-label="手机底部导航" style={{ gridTemplateColumns: `repeat(${Math.max(1, selectedMobileNavItems.length)}, minmax(0, 1fr))` }}>
        {renderNavigation(selectedMobileNavItems)}
      </nav>
      {page === "calendar" && (
        <button className="mobile-fab" onClick={() => setShowAddSchedule(true)} aria-label="新增日程">
          <Plus size={26} />
        </button>
      )}

      {semesterToEdit !== undefined && <SemesterDialog semester={semesterToEdit ?? undefined} onClose={() => setSemesterToEdit(undefined)} />}
      {showPeriodSettings && semester && <PeriodSettingsDialog semester={semester} onClose={() => setShowPeriodSettings(false)} />}
      {showThemeSkinSettings && <ThemeSkinDialog value={themeSkin} onChange={setThemeSkin} onClose={() => setShowThemeSkinSettings(false)} />}
      {showBackup && <BackupDialog onClose={() => setShowBackup(false)} />}
      {showBatchEvents && <BatchEventsDialog events={events} categories={categories} occurrenceStates={occurrenceStates} onClose={() => setShowBatchEvents(false)} />}
      {showDataHealth && <DataHealthDialog ownerId={ownerId} onClose={() => setShowDataHealth(false)} />}
      {showStats && semester && (
        <StatsDialog
          semester={semester}
          courses={courses}
          schedules={schedules}
          periods={periods}
          events={events}
          categories={categories}
          occurrenceStates={occurrenceStates}
          focusSessions={focusSessions}
          onClose={() => setShowStats(false)}
        />
      )}
      {showQuickEntry && (
        <QuickEntryDialog
          ownerId={ownerId}
          onCreated={(item) => {
            setEventToEdit(item);
            setPage("calendar");
          }}
          onClose={() => setShowQuickEntry(false)}
        />
      )}
      {showScheduleAssistant && (
        <ScheduleAssistantDialog
          input={{
            semester,
            courses,
            schedules,
            cancellations,
            events,
            categories,
            occurrenceStates,
            anniversaries,
            memos,
            periods,
            focusSessions
          }}
          onClose={() => setShowScheduleAssistant(false)}
        />
      )}
      {showDeepSeekAssistant && (
        <DeepSeekAssistantDialog
          input={{
            semester,
            courses,
            schedules,
            cancellations,
            events,
            categories,
            occurrenceStates,
            anniversaries,
            memos,
            periods,
            focusSessions
          }}
          ownerId={ownerId}
          userEmail={user?.email}
          onClose={() => setShowDeepSeekAssistant(false)}
        />
      )}
      {showAdmin && <AdminDialog onClose={() => setShowAdmin(false)} />}
      {showMobileNavSettings && (
        <MobileNavSettingsDialog
          options={navItems.map((item) => ({ id: item.id, label: item.label }))}
          value={mobileNavItems}
          onChange={setMobileNavItems}
          onClose={() => setShowMobileNavSettings(false)}
        />
      )}
      {showHeaderToolSettings && (
        <HeaderToolSettingsDialog
          options={headerTools.map((item) => ({ id: item.id, label: item.label }))}
          value={headerToolItems}
          onChange={setHeaderToolItems}
          onClose={() => setShowHeaderToolSettings(false)}
        />
      )}
      {showSchoolImport && semester && <SchoolTimetableImportDialog semester={semester} onClose={() => setShowSchoolImport(false)} />}
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
          courseAvailable={Boolean(semester)}
          onAddCourse={() => {
            setShowAddSchedule(false);
            if (semester) setCourseToEdit(null);
            else setSemesterToEdit(null);
          }}
          onAddEvent={() => {
            setShowAddSchedule(false);
            openNewEvent(toISODate(dates[selectedDay]), "09:00", "10:00");
          }}
          onAddHabit={() => {
            setShowAddSchedule(false);
            openNewEvent(toISODate(dates[selectedDay]), "09:00", "09:10", false, "habit");
          }}
          onQuickEntry={() => {
            setShowAddSchedule(false);
            setShowQuickEntry(true);
          }}
          onClose={() => setShowAddSchedule(false)}
        />
      )}
      {showCourseManager && semester && (
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
      {courseToEdit !== undefined && semester && <CourseDialog semester={semester} course={courseToEdit ?? undefined} onClose={() => setCourseToEdit(undefined)} />}
      {(eventDraft || eventToEdit !== undefined) && (
        <EventDialog
          eventItem={eventToEdit ?? undefined}
          initialDate={eventToEdit?.start_date ?? eventDraft?.date ?? toISODate(new Date())}
          initialStartTime={eventDraft?.start}
          initialEndTime={eventDraft?.end}
          initialAllDay={eventDraft?.allDay}
          initialEventType={eventToEdit?.event_type ?? eventDraft?.eventType}
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
      {showGlobalSearch && (
        <GlobalSearchDialog
          courses={courses}
          events={events}
          categories={categories}
          anniversaries={anniversaries as Anniversary[]}
          memos={memos as Memo[]}
          onOpen={openGlobalSearchResult}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}
      <ToastHost />
    </div>
  );
}
