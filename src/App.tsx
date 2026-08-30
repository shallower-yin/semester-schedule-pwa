import { useLiveQuery } from "dexie-react-hooks";
import {
  Bot,
  BookOpen,
  BrainCircuit,
  CalendarCheck2,
  CalendarHeart,
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  FileImage,
  GraduationCap,
  HeartPulse,
  LogIn,
  Languages,
  Menu,
  MessageSquareText,
  Network,
  NotebookText,
  AudioLines,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Palette,
  Type,
  Target,
  Trash2,
  X
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AccountDialog } from "./components/AccountDialog";
import { AssistantDialogs } from "./components/AssistantDialogs";
const AdminDialog = lazy(() => import("./components/AdminDialog").then((module) => ({ default: module.AdminDialog })));
import { AddScheduleDialog } from "./components/AddScheduleDialog";
import { AnniversaryPage } from "./components/AnniversaryPage";
import { AuthDialog } from "./components/AuthDialog";
import { AiTaskCenter } from "./components/AiTaskCenter";
import { BackupDialog } from "./components/BackupDialog";
import { BatchEventsDialog } from "./components/BatchEventsDialog";
import { CourseDialog } from "./components/CourseDialog";
import { CourseManagerDialog } from "./components/CourseManagerDialog";
import { DataHealthDialog } from "./components/DataHealthDialog";
import { EventDialog } from "./components/EventDialog";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { FontSizeDialog } from "./components/FontSizeDialog";
import { FocusPage } from "./components/FocusPage";
import { FocusFloatingTimer } from "./components/FocusFloatingTimer";
import { GlobalSearchDialog, type GlobalSearchResult } from "./components/GlobalSearchDialog";
import { HabitPage } from "./components/HabitPage";
import { HealthPage } from "./components/HealthPage";
import { HeaderToolSettingsDialog } from "./components/HeaderToolSettingsDialog";
import { HelpPage } from "./components/HelpPage";
import { InstallDialog } from "./components/InstallDialog";
import { MemoPage } from "./components/MemoPage";
import { MobileNavSettingsDialog } from "./components/MobileNavSettingsDialog";
import { PeriodSettingsDialog } from "./components/PeriodSettingsDialog";
import { QuickEntryDialog } from "./components/QuickEntryDialog";
import { ScheduleSnapshotDialog } from "./components/ScheduleSnapshotDialog";
import { SemesterDialog } from "./components/SemesterDialog";
const SchoolTimetableImportDialog = lazy(() => import("./components/SchoolTimetableImportDialog").then((module) => ({ default: module.SchoolTimetableImportDialog })));
const StatsDialog = lazy(() => import("./components/StatsDialog").then((module) => ({ default: module.StatsDialog })));
import { ThemeSkinDialog } from "./components/ThemeSkinDialog";
import { TodayPage } from "./components/TodayPage";
import { ToastHost } from "./components/ToastHost";
import { UpdateNotesDialog } from "./components/UpdateNotesDialog";
import { WeekCalendar } from "./components/WeekCalendar";
import { db, putRecordAndQueue, queueChange } from "./db";
import {
  addDays,
  formatWeekRange,
  parseLocalDate,
  semesterWeekForDate,
  startOfWeek,
  toISODate,
  weekdayOf,
  weekDates
} from "./lib/date";
import { uniqueCategoriesByName } from "./lib/categories";
import { setEventCompletedForDate } from "./lib/eventActions";
import type { EventStatusFilter } from "./lib/eventStatusFilter";
import { setCurrentUserId, syncFields } from "./lib/identity";
import { deleteSemesterCascade } from "./lib/semesters";
import { checkDueLocalReminders, enableNotifications } from "./lib/notifications";
import { checkDueHealthReminder, recordHealthMovementReminderSent } from "./lib/health";
import { DESKTOP_HEADER_TOOLS, loadHeaderToolSettings, type HeaderToolId } from "./lib/headerToolSettings";
import { applyAppFontSize, appFontSizeLabel, loadAppFontSize, type AppFontSizeId } from "./lib/fontSizes";
import { loadMobileNavSettings } from "./lib/mobileNavSettings";
import { applyDocumentThemeSkin, loadThemeSkin, themeSkinLabel, type ThemeSkinId } from "./lib/themeSkins";
import { getAdminStatus } from "./lib/admin";
import { buildScheduleOverview, type ScheduleOverviewItem } from "./lib/overview";
import { ensureScheduledLocalBackup } from "./lib/autoBackup";
import { BACKUP_STATUS_CHANGED_EVENT, getLastBackupAt } from "./lib/backupStatus";
import { showToast } from "./lib/toast";
import { AI_TASK_OPEN_EVENT, type AiTaskFeature } from "./lib/aiBackgroundTasks";
import { appHistoryLayer, appHistoryPage, initializeAppHistory, navigateAppHistory } from "./lib/appHistory";
import { useHistoryLayer } from "./lib/useHistoryLayer";
import { useGlobalShortcuts } from "./lib/useGlobalShortcuts";
import { appMirrorApkUrl } from "./lib/appHosting";
import { apkDownloadUrlForRelease, appUpdateEntryStatus, clearSkippedRelease, fetchLatestRelease, nativeReleaseDetails, shouldShowNativeRelease, shouldShowRelease, skipReleaseVersion, type AppRelease } from "./lib/appRelease";
import { AppUpdater } from "./lib/appUpdaterPlugin";
import { isCurrentAppUrl } from "./lib/appHosting";
import { clearAppCachesAndReload } from "./lib/appBootRecovery";
import { consumePendingNativeNotificationKey, isNativeApp, NATIVE_NOTIFICATION_OPEN_EVENT } from "./lib/nativeApp";
import { currentLiveQueryValue, currentOwnerRecord, scopedLiveQueryValue } from "./lib/liveQueryScope";
import type { SearchNavigationMatch } from "./lib/searchNavigation";
import { ScheduleWidget } from "./lib/scheduleWidgetPlugin";
import { buildWidgetSnapshot } from "./lib/widgetSnapshot";
import { resetAccountFocusPresentation } from "./lib/focusPresentation";
import {
  clearCapturedInstallPrompt,
  getCapturedInstallPrompt,
  PWA_INSTALL_AVAILABLE_EVENT,
  type BeforeInstallPromptEvent
} from "./lib/pwaInstall";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { adoptAnonymousData, getLastSync, getSyncHealth, syncNow, type SyncResult } from "./lib/sync";
import { buildSyncStatus } from "./lib/syncStatus";
import type { Anniversary, Course, EventItem, EventType, Memo, PageId, Semester } from "./types";

type Page = PageId;
type ScheduleFilter = "all" | "courses" | "uncategorized" | string;

interface EventDraft {
  ownerId: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  eventType: EventType;
}

function useEditorInstanceToken(
  identity: string,
  generationRef: React.MutableRefObject<number>,
  activeTokenRef: React.MutableRefObject<string>
): string {
  const previousIdentityRef = useRef("closed");
  const tokenRef = useRef("closed");
  if (previousIdentityRef.current !== identity) {
    previousIdentityRef.current = identity;
    generationRef.current += 1;
    tokenRef.current = identity === "closed" ? "closed" : `${identity}:${generationRef.current}`;
  }
  activeTokenRef.current = tokenRef.current;
  return tokenRef.current;
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
  if (!value) return "尚未备份";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未备份";
  return `上次备份 ${date.toLocaleString("zh-CN", {
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
  const [nativeNotificationKey, setNativeNotificationKey] = useState<string | null>(() => consumePendingNativeNotificationKey());
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [overviewNow, setOverviewNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => weekdayOf(new Date()) - 1);
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
  const [showTranslation, setShowTranslation] = useState(false);
  const [showMindMap, setShowMindMap] = useState(false);
  const [showAudioTranscription, setShowAudioTranscription] = useState(false);
  const [showAiToolbox, setShowAiToolbox] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMobileNavSettings, setShowMobileNavSettings] = useState(false);
  const [showHeaderToolSettings, setShowHeaderToolSettings] = useState(false);
  const [showThemeSkinSettings, setShowThemeSkinSettings] = useState(false);
  const [themeSkin, setThemeSkin] = useState<ThemeSkinId>(() => loadThemeSkin());
  const [showFontSizeSettings, setShowFontSizeSettings] = useState(false);
  const [fontSize, setFontSize] = useState<AppFontSizeId>(() => loadAppFontSize());
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
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getCapturedInstallPrompt());
  const [installed, setInstalled] = useState(() => isNativeApp() || window.matchMedia("(display-mode: standalone)").matches);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSchoolImport, setShowSchoolImport] = useState(false);
  const [snapshotMode, setSnapshotMode] = useState<"day" | "week" | null>(null);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [anniversaryToOpen, setAnniversaryToOpen] = useState<string | null>(null);
  const [memoToOpen, setMemoToOpen] = useState<string | null>(null);
  const [courseSearchMatch, setCourseSearchMatch] = useState<SearchNavigationMatch | null>(null);
  const [eventSearchMatch, setEventSearchMatch] = useState<SearchNavigationMatch | null>(null);
  const [anniversarySearchMatch, setAnniversarySearchMatch] = useState<SearchNavigationMatch | null>(null);
  const [memoSearchMatch, setMemoSearchMatch] = useState<SearchNavigationMatch | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const pageRef = useRef(page);
  pageRef.current = page;
  const requestSidebarClose = useHistoryLayer(sidebarOpen, () => setSidebarOpen(false), "sidebar");

  useEffect(() => {
    applyAppFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    initializeAppHistory(pageRef.current);
    const handlePageHistory = (event: PopStateEvent) => {
      const targetPage = appHistoryPage(event.state);
      if (!targetPage) return;
      pageRef.current = targetPage;
      setPage(targetPage);
      setSidebarOpen(false);
    };
    window.addEventListener("popstate", handlePageHistory);
    return () => window.removeEventListener("popstate", handlePageHistory);
  }, []);

  useEffect(() => {
    const openFeature = (feature: AiTaskFeature) => {
      if (feature === "assistant") setShowDeepSeekAssistant(true);
      if (feature === "translation") setShowTranslation(true);
      if (feature === "mind_map") setShowMindMap(true);
      if (feature === "audio_transcription") setShowAudioTranscription(true);
    };
    const consumeFeatureFromUrl = () => {
      const url = new URL(window.location.href);
      const feature = url.searchParams.get("ai");
      if (feature !== "assistant" && feature !== "translation" && feature !== "mind_map" && feature !== "audio_transcription") return;
      openFeature(feature);
      url.searchParams.delete("ai");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    };
    const handleOpenTask = (event: Event) => {
      const feature = (event as CustomEvent<{ feature?: AiTaskFeature }>).detail?.feature;
      if (feature) openFeature(feature);
    };
    consumeFeatureFromUrl();
    window.addEventListener(AI_TASK_OPEN_EVENT, handleOpenTask);
    window.addEventListener("popstate", consumeFeatureFromUrl);
    return () => {
      window.removeEventListener(AI_TASK_OPEN_EVENT, handleOpenTask);
      window.removeEventListener("popstate", consumeFeatureFromUrl);
    };
  }, []);
  const [availableRelease, setAvailableRelease] = useState<AppRelease | null>(null);
  const [mobileNavItems, setMobileNavItems] = useState<PageId[]>(() => loadMobileNavSettings());
  const [headerToolItems, setHeaderToolItems] = useState<HeaderToolId[]>(() => loadHeaderToolSettings());
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("all");
  const [isAdmin, setIsAdmin] = useState(false);
  const ownerId = user?.id ?? "local";
  const previousOwnerIdRef = useRef(ownerId);
  const semesterEditorGenerationRef = useRef(0);
  const courseEditorGenerationRef = useRef(0);
  const eventEditorGenerationRef = useRef(0);
  const semesterEditorTokenRef = useRef("closed");
  const courseEditorTokenRef = useRef("closed");
  const eventEditorTokenRef = useRef("closed");

  useEffect(() => applyDocumentThemeSkin(themeSkin), [themeSkin]);

  useEffect(() => {
    if (previousOwnerIdRef.current === ownerId) return;
    previousOwnerIdRef.current = ownerId;
    setSemesterToEdit(undefined);
    setCourseToEdit(undefined);
    setEventToEdit(undefined);
    setEventDraft(null);
    setAnniversaryToOpen(null);
    setMemoToOpen(null);
    setCourseSearchMatch(null);
    setEventSearchMatch(null);
    setAnniversarySearchMatch(null);
    setMemoSearchMatch(null);
    setShowPeriodSettings(false);
    setShowBackup(false);
    setShowBatchEvents(false);
    setShowDataHealth(false);
    setShowStats(false);
    setShowQuickEntry(false);
    setShowScheduleAssistant(false);
    setShowDeepSeekAssistant(false);
    setShowTranslation(false);
    setShowMindMap(false);
    setShowAudioTranscription(false);
    setShowAiToolbox(false);
    setShowAdmin(false);
    setShowAddSchedule(false);
    setShowCourseManager(false);
    setShowAccount(false);
    setShowFeedback(false);
    setShowSchoolImport(false);
    setSnapshotMode(null);
    setShowGlobalSearch(false);
    // FocusPage is keyed by owner so an account switch unmounts the old
    // instance immediately.  Native fullscreen/overlay state lives outside
    // React, so explicitly tear it down here as well; otherwise the previous
    // account's floating timer or immersive flags could survive the unmount.
    void resetAccountFocusPresentation();
  }, [ownerId]);

  const semesterToEditForOwner = currentOwnerRecord(semesterToEdit, ownerId);
  const courseToEditForOwner = currentOwnerRecord(courseToEdit, ownerId);
  const eventToEditForOwner = currentOwnerRecord(eventToEdit, ownerId);
  const eventDraftForOwner = eventDraft?.ownerId === ownerId ? eventDraft : null;
  const semesterEditorIdentity = semesterToEditForOwner === undefined
    ? "closed"
    : `${ownerId}:${semesterToEditForOwner?.id ?? "new"}`;
  const eventEditorIdentity = !eventDraftForOwner && eventToEditForOwner === undefined
    ? "closed"
    : `${ownerId}:${eventToEditForOwner?.id ?? `new:${eventDraftForOwner?.date ?? "direct"}:${eventDraftForOwner?.start ?? ""}:${eventDraftForOwner?.end ?? ""}:${eventDraftForOwner?.eventType ?? "event"}:${eventDraftForOwner?.allDay ? "all-day" : "timed"}`}`;
  const semesterEditorToken = useEditorInstanceToken(semesterEditorIdentity, semesterEditorGenerationRef, semesterEditorTokenRef);
  const eventEditorToken = useEditorInstanceToken(eventEditorIdentity, eventEditorGenerationRef, eventEditorTokenRef);

  const ownerQueryScope = ownerId;
  const semesterResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      ownerQueryScope,
      (await db.semesters.filter((item) => item.user_id === ownerId && item.is_current && !item.deleted_at).first()) ?? null
    ),
    [ownerQueryScope]
  );
  const semesterQuery = currentLiveQueryValue(semesterResult, ownerQueryScope);
  const semester = semesterQuery ?? null;
  const courseToEditForSemester = courseToEditForOwner == null
    ? courseToEditForOwner
    : courseToEditForOwner.semester_id === semester?.id
      ? courseToEditForOwner
      : undefined;
  const courseEditorIdentity = courseToEditForSemester === undefined || !semester
    ? "closed"
    : `${ownerId}:${semester.id}:${courseToEditForSemester?.id ?? "new"}`;
  const courseEditorToken = useEditorInstanceToken(courseEditorIdentity, courseEditorGenerationRef, courseEditorTokenRef);
  const semestersResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      ownerQueryScope,
      await db.semesters.filter((item) => item.user_id === ownerId && !item.deleted_at).reverse().sortBy("start_date")
    ),
    [ownerQueryScope]
  );
  const semestersQuery = currentLiveQueryValue(semestersResult, ownerQueryScope);
  const semesters = semestersQuery ?? [];
  const semesterDataScope = JSON.stringify([ownerId, semester?.id ?? null]);
  const coursesResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      semesterDataScope,
      semester
        ? await db.courses.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()
        : []
    ),
    [semesterDataScope]
  );
  const coursesQuery = currentLiveQueryValue(coursesResult, semesterDataScope);
  const courses = coursesQuery ?? [];
  const schedulesDataScope = JSON.stringify([ownerId, courses.map((course) => course.id).sort()]);
  const schedulesResult = useLiveQuery(
    async () => {
      if (!courses.length) return scopedLiveQueryValue(schedulesDataScope, []);
      const courseIds = new Set(courses.map((course) => course.id));
      const value = await db.courseSchedules.filter((item) => item.user_id === ownerId && courseIds.has(item.course_id) && !item.deleted_at).toArray();
      return scopedLiveQueryValue(schedulesDataScope, value);
    },
    [schedulesDataScope]
  );
  const schedulesQuery = currentLiveQueryValue(schedulesResult, schedulesDataScope);
  const schedules = schedulesQuery ?? [];
  const cancellationsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.courseCancellations.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const cancellationsQuery = currentLiveQueryValue(cancellationsResult, ownerQueryScope);
  const cancellations = cancellationsQuery ?? [];
  const eventsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const eventsQuery = currentLiveQueryValue(eventsResult, ownerQueryScope);
  const events = eventsQuery ?? [];
  const categoriesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.categories.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const categoriesQuery = currentLiveQueryValue(categoriesResult, ownerQueryScope);
  const categories = useMemo(() => uniqueCategoriesByName(categoriesQuery ?? []), [categoriesQuery]);
  const occurrenceStatesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.eventOccurrenceStates.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const occurrenceStatesQuery = currentLiveQueryValue(occurrenceStatesResult, ownerQueryScope);
  const occurrenceStates = occurrenceStatesQuery ?? [];
  const anniversariesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.anniversaries.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const anniversariesQuery = currentLiveQueryValue(anniversariesResult, ownerQueryScope);
  const anniversaries = anniversariesQuery ?? [];
  const memosResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.memos.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const memosQuery = currentLiveQueryValue(memosResult, ownerQueryScope);
  const memos = memosQuery ?? [];
  const focusSessionsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.focusSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const focusSessionsQuery = currentLiveQueryValue(focusSessionsResult, ownerQueryScope);
  const focusSessions = focusSessionsQuery ?? [];
  const periodsResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      semesterDataScope,
      semester
        ? await db.classPeriods.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()
        : []
    ),
    [semesterDataScope]
  );
  const periodsQuery = currentLiveQueryValue(periodsResult, semesterDataScope);
  const periods = periodsQuery ?? [];

  useEffect(() => {
    if (semesterQuery === undefined || !courseToEdit) return;
    if (courseToEdit.user_id === ownerId && courseToEdit.semester_id === semester?.id) return;
    setCourseSearchMatch(null);
    setCourseToEdit(undefined);
  }, [courseToEdit, ownerId, semester?.id, semesterQuery]);
  const widgetDataReady = authReady
    && semesterQuery !== undefined
    && semestersQuery !== undefined
    && coursesQuery !== undefined
    && schedulesQuery !== undefined
    && cancellationsQuery !== undefined
    && eventsQuery !== undefined
    && categoriesQuery !== undefined
    && occurrenceStatesQuery !== undefined
    && periodsQuery !== undefined
    && focusSessionsQuery !== undefined;
  const pendingChangesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.syncQueue.where("owner_id").equals(ownerId).count()),
    [ownerQueryScope]
  );
  const pendingChanges = currentLiveQueryValue(pendingChangesResult, ownerQueryScope) ?? 0;
  const syncHealthResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await getSyncHealth(ownerId)),
    [ownerId, pendingChanges, syncMessage, syncing, user?.id]
  );
  const syncHealth = currentLiveQueryValue(syncHealthResult, ownerQueryScope) ?? null;

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
  const assistantInput = useMemo(
    () => ({ semester, courses, schedules, cancellations, events, categories, occurrenceStates, anniversaries, memos, periods, focusSessions }),
    [semester, courses, schedules, cancellations, events, categories, occurrenceStates, anniversaries, memos, periods, focusSessions]
  );

  // Clear the previous account's native projection as soon as authentication
  // resolves to a different owner. Do not wait for every Dexie query to finish:
  // a slow query must never leave another account's schedule on the launcher.
  useEffect(() => {
    if (!isNativeApp() || !authReady) return;
    void ScheduleWidget.setActiveOwner({ ownerId }).catch(() => {
      // Older Android shells do not expose this optional bridge.
    });
  }, [authReady, ownerId]);

  // The launcher widget is a native, read-only projection.  Keep all schedule
  // calculation in the existing Web/Dexie layer and publish only after every
  // relevant live query has produced its first result for the active account.
  useEffect(() => {
    if (!isNativeApp() || !widgetDataReady) return;
    let cancelled = false;
    const publish = async () => {
      try {
        // Re-activating the same owner is idempotent on the native side and
        // makes this first publication race-free with account changes.
        await ScheduleWidget.setActiveOwner({ ownerId });
        if (cancelled) return;
        const snapshot = buildWidgetSnapshot({
          ownerId,
          semester,
          courses,
          schedules,
          cancellations,
          events,
          categories,
          occurrenceStates,
          periods,
          focusSessions
        }, new Date());
        await ScheduleWidget.updateSnapshot({
          ownerId,
          snapshotJson: JSON.stringify({ ...snapshot, ownerId })
        });
      } catch {
        // Widget support is best-effort; schedule editing must continue even
        // when an older native shell does not have the bridge yet.
      }
    };

    void publish();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void publish();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onVisibilityChange);
    };
  }, [
    authReady,
    categories,
    cancellations,
    courses,
    events,
    focusSessions,
    ownerId,
    occurrenceStates,
    periods,
    schedules,
    semester,
    user?.id,
    widgetDataReady
  ]);

  useEffect(() => {
    const handleOpen = (event: Event) => setNativeNotificationKey((event as CustomEvent<string>).detail || null);
    window.addEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, handleOpen);
    const pending = consumePendingNativeNotificationKey();
    if (pending) setNativeNotificationKey(pending);
    return () => window.removeEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!nativeNotificationKey) return;
    if (nativeNotificationKey === "route:quick-entry") {
      if (!authReady) return;
      setShowQuickEntry(true);
      setNativeNotificationKey(null);
      return;
    }
    if (nativeNotificationKey === "route:today") {
      goToday();
      navigate("today");
      setNativeNotificationKey(null);
      return;
    }
    if (nativeNotificationKey === "route:focus") {
      navigate("focus");
      setNativeNotificationKey(null);
      return;
    }
    const eventMatch = /^event:([^:]+):/.exec(nativeNotificationKey);
    if (eventMatch) {
      if (!authReady || eventsQuery === undefined) return;
      const target = eventsQuery.find((item) => item.id === eventMatch[1] && item.user_id === ownerId);
      navigate(target?.event_type === "habit" ? "habits" : "calendar");
      if (target) setEventToEdit(target);
      else showToast("这条提醒对应的事项已被删除。", "info");
      setNativeNotificationKey(null);
      return;
    }
    const anniversaryMatch = /^anniversary:([^:]+):/.exec(nativeNotificationKey);
    if (anniversaryMatch) {
      if (!authReady || anniversariesQuery === undefined) return;
      if (!anniversariesQuery.some((item) => item.id === anniversaryMatch[1] && item.user_id === ownerId)) {
        showToast("这条提醒对应的日子已被删除。", "info");
        setNativeNotificationKey(null);
        return;
      }
      navigate("anniversaries");
      setAnniversaryToOpen(anniversaryMatch[1]);
      setNativeNotificationKey(null);
      return;
    }
    if (nativeNotificationKey === "health") navigate("health");
    setNativeNotificationKey(null);
  }, [anniversariesQuery, authReady, eventsQuery, nativeNotificationKey, ownerId]);
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

  const checkRelease = useCallback(async (options?: { force?: boolean }) => {
    if (options?.force) clearSkippedRelease();
    const release = await fetchLatestRelease();
    if (!release) {
      setAvailableRelease(null);
      return null;
    }
    if (isNativeApp()) {
      try {
        const native = await AppUpdater.getNativeVersion();
        const apkRelease = nativeReleaseDetails(release);
        const show = shouldShowNativeRelease(native, apkRelease);
        setAvailableRelease(show ? apkRelease : null);
        return show ? apkRelease : null;
      } catch {
        // Without the native versionCode we cannot safely claim that an APK is installable.
        setAvailableRelease(null);
        return null;
      }
    }
    const show = shouldShowRelease(__APP_VERSION__, release);
    setAvailableRelease(show ? release : null);
    return show ? release : null;
  }, []);

  useEffect(() => {
    let active = true;
    void checkRelease().then((release) => {
      if (!active && release) {
        // effect cleaned up; ignore
      }
    });
    return () => {
      active = false;
    };
  }, [needRefresh, checkRelease]);

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
    const check = () => void Promise.allSettled([
      checkDueLocalReminders(ownerId),
      checkDueHealthReminder(ownerId)
    ]);
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
    if (!("serviceWorker" in navigator)) return;
    const onServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; reminderAt?: string } | undefined;
      if (data?.type !== "health-reminder-delivered") return;
      const reminderAt = data.reminderAt ? new Date(data.reminderAt) : new Date();
      if (Number.isNaN(reminderAt.getTime())) return;
      void recordHealthMovementReminderSent(ownerId, reminderAt);
    };
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
  }, [ownerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setOverviewNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshBackupStatus = () => setLastBackupAt(getLastBackupAt(ownerId));
    refreshBackupStatus();
    window.addEventListener(BACKUP_STATUS_CHANGED_EVENT, refreshBackupStatus);
    window.addEventListener("storage", refreshBackupStatus);
    return () => {
      window.removeEventListener(BACKUP_STATUS_CHANGED_EVENT, refreshBackupStatus);
      window.removeEventListener("storage", refreshBackupStatus);
    };
  }, [ownerId]);

  useEffect(() => {
    if (!authReady) return;
    void ensureScheduledLocalBackup(ownerId).catch(() => undefined);
  }, [authReady, ownerId]);

  useGlobalShortcuts({
    onSearch: () => setShowGlobalSearch(true),
    onNewToday: () => openNewEvent(toISODate(new Date()), "09:00", "10:00"),
    onQuickEntry: () => setShowQuickEntry(true),
    onScheduleAssistant: () => setShowScheduleAssistant(true),
    onAssistant: () => setShowDeepSeekAssistant(true),
    onMindMap: () => setShowMindMap(true),
    onToday: () => {
      goToday();
      navigate("today");
    },
    onEscape: () => {
      if (appHistoryLayer(window.history.state) || pageRef.current !== "today") window.history.back();
      else if (sidebarOpen) requestSidebarClose();
    }
  });

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
      setSyncMessage(`同步完成：上传 ${result.uploaded} 条，下载 ${result.downloaded} 条${result.kept_local > 0 ? `，保留本机未上传改动 ${result.kept_local} 条` : ""}。`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
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

  async function applyAppUpdate(mode: "immediate" | "background" = "immediate") {
    if (updatingApp) return;
    const release = availableRelease;
    if (!release && !needRefresh) return;
    setUpdatingApp(true);

    // Android APK: download signed package and hand it to the system installer (cover update, same key).
    if (isNativeApp()) {
      if (!release) {
        setUpdatingApp(false);
        return;
      }
      try {
        // Absolute HTTPS only — relative paths fail in the native downloader and look like "未配置".
        const apkUrl = apkDownloadUrlForRelease(release) || appMirrorApkUrl;
        if (!apkUrl || !/^https?:\/\//i.test(apkUrl)) {
          throw new Error("当前更新通道尚未配置 APK 下载地址，请稍后从分发页安装，或联系管理员。");
        }
        setUpdateMessage(mode === "background" ? "正在后台下载安装包…" : "正在下载安装包…");
        if (mode === "background") {
          setAvailableRelease(null);
          showToast("已开始后台下载安装包，下载完成后会打开系统安装界面。", "info");
        }
        const permission = await AppUpdater.canRequestPackageInstalls();
        if (!permission.granted) {
          const requested = await AppUpdater.requestPackageInstallPermission();
          if (!requested.granted) throw new Error("需要允许“安装未知应用”后才能覆盖更新。");
        }
        setUpdateMessage("正在下载安装包，请保持网络畅通…");
        await AppUpdater.downloadAndInstall({
          url: apkUrl,
          sha256: release.apkSha256
        });
        setUpdateMessage("已打开系统安装界面，确认后即可覆盖更新。");
        showToast("请在系统安装界面确认更新（无需卸载）。", "success", 6000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "APK 更新失败，请稍后重试。";
        setAvailableRelease(release);
        setUpdateMessage(message);
        showToast(message, "error", 6000);
      } finally {
        setUpdatingApp(false);
      }
      return;
    }

    if (mode === "background") {
      if (!release) {
        setUpdatingApp(false);
        return;
      }
      setAvailableRelease(null);
      setUpdateMessage("正在通知本站后台服务检查新版本…");
      showToast("已开始后台检查新版本，你可以继续使用应用。", "info");
      try {
        // Only the current origin's Service Worker may update its caches.
        // Never copy assets from a mirror origin into this origin's cache:
        // a mirror compromise would otherwise become arbitrary script execution.
        await updateServiceWorker(false);
        skipReleaseVersion(release.version);
        setUpdateMessage("后台检查已完成；新版本准备好后会显示刷新提示。");
        showToast("后台检查已完成。检测到新版本后，应用会提示你刷新。", "success", 6000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "后台更新失败，请稍后重试。";
        setAvailableRelease(release);
        setUpdateMessage(message);
        showToast(`后台更新失败：${message}`, "error", 6000);
      } finally {
        setUpdatingApp(false);
      }
      return;
    }
    if (release?.appUrl && !isCurrentAppUrl(release.appUrl)) {
      if (!user && pendingChanges > 0) {
        setUpdatingApp(false);
        const message = "切换到免代理更新线路前，请先登录同步或导出 JSON 备份，避免本机数据留在旧网址。";
        setUpdateMessage(message);
        showToast(message, "error");
        return;
      }
      if (user && pendingChanges > 0) {
        const syncResult = await handleSync();
        if (!syncResult) {
          setUpdatingApp(false);
          setUpdateMessage("同步未完成，已取消切换更新线路。");
          return;
        }
      }
      setUpdateMessage("正在切换到免代理更新线路…");
      window.location.assign(release.appUrl);
      return;
    }

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
      const regularError = error instanceof Error ? error.message : "请稍后重试。";
      const message = `更新失败：${regularError}`;
      setUpdateMessage(message);
      showToast(message, "error");
    }
  }

  function skipAvailableRelease() {
    if (!availableRelease) return;
    skipReleaseVersion(availableRelease.version, availableRelease.apkVersionCode);
    setAvailableRelease(null);
    setNeedRefresh(false);
  }

  async function hardReloadApp() {
    setUpdatingApp(true);
    setUpdateMessage("正在清理缓存并重新加载…");
    await clearAppCachesAndReload("reload");
  }

  function navigate(nextPage: Page) {
    if (nextPage !== pageRef.current || appHistoryLayer(window.history.state)) {
      navigateAppHistory(nextPage);
    }
    pageRef.current = nextPage;
    setPage(nextPage);
    setSidebarOpen(false);
  }

  function moveWeek(amount: number) {
    setAnchorDate((current) => addDays(current, amount * 7));
  }

  function goToday() {
    setAnchorDate(new Date());
    setSelectedDay(weekdayOf(new Date()) - 1);
  }

  function moveMobileDay(direction: number, nextSelectedDay: number) {
    setAnchorDate((current) => addDays(current, direction * 7));
    setSelectedDay(nextSelectedDay);
  }

  function openNewEvent(date: string, start: string, end: string, allDay = false, eventType: EventType = "event") {
    setEventDraft({ ownerId, date, start, end, allDay, eventType });
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
    setSemesterToEdit(undefined);
    setCourseToEdit(undefined);
    setEventToEdit(undefined);
    setEventDraft(null);
    setCourseSearchMatch(null);
    setEventSearchMatch(null);
    setAnniversaryToOpen(null);
    setMemoToOpen(null);
    setAnniversarySearchMatch(null);
    setMemoSearchMatch(null);
    if (result.type === "course") {
      const course = courses.find((candidate) => candidate.id === result.id && candidate.user_id === ownerId);
      if (course) {
        setCourseSearchMatch(result.match ?? null);
        setCourseToEdit(course);
        navigate("calendar");
      }
      return;
    }
    if (result.type === "event") {
      const eventItem = events.find((candidate) => candidate.id === result.id && candidate.user_id === ownerId);
      if (eventItem) {
        setEventSearchMatch(result.match ?? null);
        setEventToEdit(eventItem);
        navigate(eventItem.event_type === "habit" ? "habits" : "calendar");
      }
      return;
    }
    if (result.type === "anniversary") {
      setAnniversarySearchMatch(result.match ?? null);
      setAnniversaryToOpen(result.id);
      navigate("anniversaries");
      return;
    }
    setMemoSearchMatch(result.match ?? null);
    setMemoToOpen(result.id);
    navigate("memos");
  }

  async function activateSemester(target: Semester) {
    if (target.is_current) return;
    await db.transaction("rw", db.semesters, db.syncQueue, async () => {
      for (const item of semesters) {
        const shouldBeCurrent = item.id === target.id;
        if (item.is_current === shouldBeCurrent) continue;
        const updated = { ...item, ...syncFields(item), is_current: shouldBeCurrent };
        await putRecordAndQueue("semesters", updated);
      }
    });
    navigate("calendar");
    setAnchorDate(new Date());
  }

  async function deleteSemester(target: Semester) {
    const confirmed = window.confirm(`确定彻底删除“${target.name}”吗？该学期下的课程、节次、课程安排和停课标记会一并删除；普通事项、习惯、纪念日和备忘录不受影响。`);
    if (!confirmed) return;
    await deleteSemesterCascade(target.id);
    if (semester?.id === target.id) setAnchorDate(new Date());
  }

  const navItems: Array<{ id: PageId; label: string; mobileLabel?: string; icon: ReactNode }> = [
    { id: "today", label: "今天", icon: <CalendarCheck2 size={19} /> },
    { id: "calendar", label: "日程", icon: <CalendarDays size={19} /> },
    { id: "habits", label: "习惯", icon: <CheckCircle2 size={19} /> },
    { id: "anniversaries", label: "纪念日", icon: <CalendarHeart size={19} /> },
    { id: "memos", label: "备忘录", icon: <NotebookText size={19} /> },
    { id: "focus", label: "专注", icon: <Target size={19} /> },
    { id: "health", label: "健康", icon: <HeartPulse size={19} /> },
    { id: "settings", label: "设置", icon: <Settings size={19} /> },
    { id: "help", label: "使用说明", mobileLabel: "说明", icon: <CircleHelp size={19} /> }
  ];
  const selectedMobileNavItems = navItems
    .filter((item) => mobileNavItems.includes(item.id))
    .sort((left, right) => mobileNavItems.indexOf(left.id) - mobileNavItems.indexOf(right.id));
  const lastBackupText = formatBackupDateTime(lastBackupAt);
  const syncSummary = useMemo(() => {
    return buildSyncStatus({
      authReady,
      cloudConfigured: supabaseConfigured,
      signedIn: Boolean(user),
      userEmail: user?.email,
      syncing,
      pendingChanges,
      failedChanges: syncHealth?.failed ?? 0,
      message: syncMessage,
      lastSyncText: formatSyncDateTime(lastSync)
    });
  }, [authReady, lastSync, pendingChanges, syncHealth?.failed, syncMessage, syncing, user]);
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
      id: "translation",
      label: "翻译助手",
      node: <button className="icon-button header-search-button" onClick={() => setShowTranslation(true)} aria-label="翻译助手"><Languages size={18} /></button>
    },
    {
      id: "mindMap",
      label: "AI 思维导图",
      node: <button className="icon-button header-search-button" onClick={() => setShowMindMap(true)} aria-label="AI 思维导图"><Network size={18} /></button>
    },
    {
      id: "audioTranscription",
      label: "AI 音频转写",
      node: <button className="icon-button header-search-button" onClick={() => setShowAudioTranscription(true)} aria-label="AI 音频转写"><AudioLines size={18} /></button>
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
  const mobileHeaderTools = selectedHeaderTools;
  const desktopHeaderTools = headerTools.filter((tool) => DESKTOP_HEADER_TOOLS.includes(tool.id));

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

  function renderNavigation(items: typeof navItems, compact = false) {
    return items.map((item) => (
      <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
        {item.icon}{compact ? item.mobileLabel ?? item.label : item.label}
      </button>
    ));
  }

  return (
    <div className="app-shell" data-skin={themeSkin} data-app-target={__APP_TARGET__}>
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
          <span className="desktop-header-tools">
            {desktopHeaderTools.map((tool) => <span key={tool.id} className="header-tool">{tool.node}</span>)}
          </span>
          <span className="mobile-header-tools">
            {mobileHeaderTools.map((tool) => <span key={tool.id} className="header-tool">{tool.node}</span>)}
          </span>
        </div>
      </header>

      <FocusFloatingTimer key={ownerId} ownerId={ownerId} />

      {sidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={requestSidebarClose}>
          <aside className="mobile-sidebar" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sidebar-header"><strong>菜单</strong><button className="icon-button" onClick={requestSidebarClose}><X /></button></div>
            <nav>{renderNavigation(navItems)}</nav>
            <button className="mobile-ai-toolbox-entry" onClick={() => { setShowAiToolbox(true); setSidebarOpen(false); }}><Sparkles size={18} />AI 工具箱<ChevronRight size={17} /></button>
          </aside>
        </div>
      )}

      <main>
        {page === "memos" ? (
          <MemoPage
            key={ownerId}
            ownerId={ownerId}
            openMemoId={memoToOpen}
            openSearchMatch={memoSearchMatch}
            onOpenMemoConsumed={() => {
              setMemoToOpen(null);
            }}
            onSearchMatchClosed={() => setMemoSearchMatch(null)}
          />
        ) : page === "anniversaries" ? (
          <AnniversaryPage
            key={ownerId}
            ownerId={ownerId}
            openAnniversaryId={anniversaryToOpen}
            openSearchMatch={anniversarySearchMatch}
            onOpenAnniversaryConsumed={() => {
              setAnniversaryToOpen(null);
            }}
            onSearchMatchClosed={() => setAnniversarySearchMatch(null)}
          />
        ) : page === "habits" ? (
          <HabitPage
            habits={events}
            occurrenceStates={occurrenceStates}
            onAddHabit={() => openNewEvent(toISODate(new Date()), "09:00", "09:10", false, "habit")}
            onEditHabit={(habit) => setEventToEdit(habit)}
          />
        ) : page === "focus" ? (
          <FocusPage key={ownerId} ownerId={ownerId} />
        ) : page === "health" ? (
          <HealthPage key={ownerId} ownerId={ownerId} onSync={handleSync} />
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
              <div className="calendar-title-actions">
                <div className="week-title">
                  <h1>{semester ? (weekNumber ? `第 ${weekNumber} 周` : "学期外日期") : "本周"}</h1>
                  <span>{formatWeekRange(dates)}</span>
                </div>
                <div className="snapshot-toolbar-actions" aria-label="导出日程快照">
                  <button className="button secondary compact" onClick={() => setSnapshotMode("day")}><FileImage size={17} />日快照</button>
                  <button className="button secondary compact" onClick={() => setSnapshotMode("week")}><CalendarDays size={17} />周快照</button>
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
              onToggleEventCompleted={(item, occurrenceDate, completed) => {
                void setEventCompletedForDate(item, occurrenceStates, occurrenceDate, completed);
              }}
              onEditCourse={(item) => setCourseToEdit(item)}
            />
          </>
        ) : (
          <section className="content-page">
            <div className="page-heading"><div><h1>设置</h1><p>管理备份、界面和可选学生功能；账号同步请使用顶部按钮。</p></div></div>
            <div className="settings-sections">
              {renderSettingsSection("常用", "版本、皮肤、安装和反馈入口。", (
                <>
                  <button
                    className="setting-card"
                    disabled={updatingApp}
                    onClick={() => {
                      if (needRefresh) {
                        void applyAppUpdate();
                        return;
                      }
                      if (availableRelease) {
                        void applyAppUpdate();
                        return;
                      }
                      void (async () => {
                        setUpdateMessage("正在检查更新…");
                        const found = await checkRelease({ force: true });
                        if (found) {
                          setUpdateMessage("发现新版本，请确认更新说明。");
                          showToast("发现新版本", "success");
                          return;
                        }
                        setUpdateMessage("已是最新版本");
                        showToast(
                          isNativeApp()
                            ? "当前已是最新安装包（或网络未能拉取更新信息）。"
                            : "当前已是最新版本。",
                          "info"
                        );
                      })();
                    }}
                  >
                    <RefreshCw /><span><strong>应用版本</strong><small>{appVersion} · {appUpdateEntryStatus({
                      updating: updatingApp,
                      updateMessage,
                      hasAvailableRelease: Boolean(availableRelease),
                      serviceWorkerNeedsRefresh: needRefresh
                    })}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowThemeSkinSettings(true)}>
                    <Palette /><span><strong>界面皮肤</strong><small>{themeSkinLabel(themeSkin)} · 切换可爱或简洁风格</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowFontSizeSettings(true)}>
                    <Type /><span><strong>字体大小</strong><small>{appFontSizeLabel(fontSize)} · APK、PWA 和网页独立保存</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowInstallDialog(true)}>
                    <Download /><span><strong>安装到设备</strong><small>{installed ? "已安装，可查看 APK 与主屏幕安装方式" : "安装为独立应用，并按引导创建快捷方式"}</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowFeedback(true)}>
                    <MessageSquareText /><span><strong>意见反馈</strong><small>向管理员提交文字、图片或文档</small></span><ChevronRight />
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
                  <button className="setting-card" onClick={() => setShowSchoolImport(true)}>
                    <FileSpreadsheet /><span><strong>课表提取器</strong><small>选择学校，可导入当前学期或新建学期后导入</small></span><ChevronRight />
                  </button>
                </>
              ))}
              {renderSettingsSection("高级", "界面入口和维护功能集中放置。", (
                <>
                  <button className="setting-card" onClick={() => setShowBackup(true)}>
                    <Database /><span><strong>数据备份</strong><small>{lastBackupText} · 用于误删恢复或迁移设备</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowDataHealth(true)}>
                    <Database /><span><strong>数据健康检查</strong><small>检查同步、重复分类和异常事项</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowMobileNavSettings(true)}>
                    <SlidersHorizontal /><span><strong>底部按钮设置</strong><small>自定义手机底部显示哪几个入口和顺序</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => setShowHeaderToolSettings(true)}>
                    <SlidersHorizontal /><span><strong>顶部按钮设置</strong><small>自定义手机顶部工具；翻译快捷按钮可选</small></span><ChevronRight />
                  </button>
                  <button className="setting-card" onClick={() => void hardReloadApp()} disabled={updatingApp}>
                    <RefreshCw /><span><strong>清缓存重载</strong><small>手机 PWA 更新没生效时使用，会重新获取最新资源</small></span><ChevronRight />
                  </button>
                  {isAdmin && (
                    <button className="setting-card" onClick={() => setShowAdmin(true)}>
                      <ShieldCheck /><span><strong>管理后台</strong></span><ChevronRight />
                    </button>
                  )}
                </>
              ))}
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
                      <button type="button" className="icon-button danger" aria-label={`彻底删除${item.name}`} onClick={() => void deleteSemester(item)}>
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

      <nav
        className="mobile-bottom-nav"
        aria-label="手机底部导航"
        data-item-count={selectedMobileNavItems.length}
        style={{ "--mobile-nav-count": Math.max(1, selectedMobileNavItems.length) } as CSSProperties}
      >
        {renderNavigation(selectedMobileNavItems, true)}
      </nav>
      {page === "calendar" && (
        <button className="mobile-fab" onClick={() => setShowAddSchedule(true)} aria-label="新增日程">
          <Plus size={26} />
        </button>
      )}

      {semesterToEditForOwner !== undefined && (
        <SemesterDialog
          key={semesterEditorToken}
          ownerId={ownerId}
          semester={semesterToEditForOwner ?? undefined}
          onClose={() => {
            if (semesterEditorTokenRef.current !== semesterEditorToken) return;
            setSemesterToEdit(undefined);
          }}
        />
      )}
      {showPeriodSettings && semester && <PeriodSettingsDialog key={`${ownerId}:${semester.id}`} semester={semester} onClose={() => setShowPeriodSettings(false)} />}
      {showThemeSkinSettings && <ThemeSkinDialog value={themeSkin} onChange={setThemeSkin} onClose={() => setShowThemeSkinSettings(false)} />}
      {showFontSizeSettings && <FontSizeDialog value={fontSize} onChange={setFontSize} onClose={() => setShowFontSizeSettings(false)} />}
      {showBackup && <BackupDialog onClose={() => setShowBackup(false)} />}
      {showBatchEvents && <BatchEventsDialog events={events} categories={categories} occurrenceStates={occurrenceStates} onClose={() => setShowBatchEvents(false)} />}
      {showDataHealth && <DataHealthDialog ownerId={ownerId} onClose={() => setShowDataHealth(false)} />}
      {showStats && semester && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
      {showQuickEntry && (
        <QuickEntryDialog
          ownerId={ownerId}
          onCreated={(item) => {
            setEventToEdit(item);
            navigate("calendar");
          }}
          onClose={() => setShowQuickEntry(false)}
        />
      )}
      <AssistantDialogs
        input={assistantInput}
        ownerId={ownerId}
        userEmail={user?.email}
        showScheduleAssistant={showScheduleAssistant}
        showDeepSeekAssistant={showDeepSeekAssistant}
        showTranslation={showTranslation}
        showMindMap={showMindMap}
        showAudioTranscription={showAudioTranscription}
        showAiToolbox={showAiToolbox}
        setShowScheduleAssistant={setShowScheduleAssistant}
        setShowDeepSeekAssistant={setShowDeepSeekAssistant}
        setShowTranslation={setShowTranslation}
        setShowMindMap={setShowMindMap}
        setShowAudioTranscription={setShowAudioTranscription}
        setShowAiToolbox={setShowAiToolbox}
      />
      {showAdmin && <Suspense fallback={null}><AdminDialog onClose={() => setShowAdmin(false)} /></Suspense>}
      {showFeedback && <FeedbackDialog
        userId={user?.id ?? null}
        userEmail={user?.email}
        onRequestLogin={() => { setShowFeedback(false); setAuthDialogMode("login"); }}
        onClose={() => setShowFeedback(false)}
      />}
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
      {showSchoolImport && <Suspense fallback={null}><SchoolTimetableImportDialog ownerId={ownerId} semester={semester ?? null} onImported={(target) => setAnchorDate(parseLocalDate(target.start_date))} onClose={() => setShowSchoolImport(false)} /></Suspense>}
      {snapshotMode && (
        <ScheduleSnapshotDialog
          mode={snapshotMode}
          skinId={themeSkin}
          input={{ semester: semester ?? null, courses, schedules, cancellations, events, categories, occurrenceStates, periods }}
          onClose={() => setSnapshotMode(null)}
        />
      )}
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
          onClose={() => setShowAccount(false)}
        />
      )}
      {courseToEditForSemester !== undefined && semester && (
        <CourseDialog
          key={courseEditorToken}
          semester={semester}
          course={courseToEditForSemester ?? undefined}
          searchMatch={courseSearchMatch}
          onClose={() => {
            if (courseEditorTokenRef.current !== courseEditorToken) return;
            setCourseSearchMatch(null);
            setCourseToEdit(undefined);
          }}
        />
      )}
      {(eventDraftForOwner || eventToEditForOwner !== undefined) && (
        <EventDialog
          key={eventEditorToken}
          eventItem={eventToEditForOwner ?? undefined}
          initialDate={eventToEditForOwner?.start_date ?? eventDraftForOwner?.date ?? toISODate(new Date())}
          initialStartTime={eventDraftForOwner?.start}
          initialEndTime={eventDraftForOwner?.end}
          initialAllDay={eventDraftForOwner?.allDay}
          initialEventType={eventToEditForOwner?.event_type ?? eventDraftForOwner?.eventType}
          ownerId={ownerId}
          occurrenceStates={occurrenceStates}
          searchMatch={eventSearchMatch}
          onClose={() => {
            if (eventEditorTokenRef.current !== eventEditorToken) return;
            setEventSearchMatch(null);
            setEventDraft(null);
            setEventToEdit(undefined);
          }}
        />
      )}

      {availableRelease && (
        <UpdateNotesDialog
          currentVersion={__APP_VERSION__}
          release={availableRelease}
          updating={updatingApp}
          updateMessage={updateMessage}
          onSkip={skipAvailableRelease}
          onBackgroundUpdate={() => void applyAppUpdate("background")}
          onUpdate={() => void applyAppUpdate()}
        />
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
      <AiTaskCenter />
      <ToastHost />
    </div>
  );
}
