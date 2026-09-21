import type { PageId } from "../types";

const APP_HISTORY_KEY = "__semesterSchedule";

/**
 * Closing a dialog removes the entry it pushed with a programmatic
 * `history.back()`. That traversal still fires `popstate`, and without a marker
 * the event looks exactly like the user pressing the browser/Android back
 * button: the next dialog in the same interaction would treat it as "go back"
 * and close itself, and the page listener would follow the old entry's page.
 *
 * The marker covers exactly one traversal. Every listener for the same
 * `popstate` event runs in one task, so the marker is released in a follow-up
 * task; the next genuine back press is handled normally.
 */
let unwindPending = false;
let unwindSafetyTimer: number | null = null;

export function markAppHistoryUnwind(): void {
  unwindPending = true;
  window.addEventListener("popstate", releaseAppHistoryUnwind, { once: true });
  if (unwindSafetyTimer !== null) window.clearTimeout(unwindSafetyTimer);
  // If the traversal never happens (for example the entry was already popped),
  // release the marker anyway so it cannot swallow a later back press.
  unwindSafetyTimer = window.setTimeout(resetAppHistoryUnwind, 1000);
}

export function isAppHistoryUnwinding(): boolean {
  return unwindPending;
}

export function resetAppHistoryUnwind(): void {
  unwindPending = false;
  if (unwindSafetyTimer !== null) {
    window.clearTimeout(unwindSafetyTimer);
    unwindSafetyTimer = null;
  }
}

function releaseAppHistoryUnwind(): void {
  window.setTimeout(resetAppHistoryUnwind, 0);
}

interface AppHistoryMarker {
  page?: PageId;
  layerId?: string;
}

type HistoryRecord = Record<string, unknown> & {
  [APP_HISTORY_KEY]?: AppHistoryMarker;
};

export function initializeAppHistory(page: PageId): void {
  const state = historyRecord(window.history.state);
  window.history.replaceState(withMarker(state, { ...state[APP_HISTORY_KEY], page }), "");
}

export function navigateAppHistory(page: PageId): void {
  const state = historyRecord(window.history.state);
  const nextState = withMarker(state, { page });
  if (state[APP_HISTORY_KEY]?.layerId) {
    window.history.replaceState(nextState, "");
  } else {
    window.history.pushState(nextState, "");
  }
}

export function appHistoryPage(state: unknown): PageId | null {
  const page = historyRecord(state)[APP_HISTORY_KEY]?.page;
  return isPageId(page) ? page : null;
}

export function pushAppHistoryLayer(layerId: string): void {
  const state = historyRecord(window.history.state);
  window.history.pushState(withMarker(state, { ...state[APP_HISTORY_KEY], layerId }), "");
}

export function isCurrentAppHistoryLayer(layerId: string): boolean {
  return historyRecord(window.history.state)[APP_HISTORY_KEY]?.layerId === layerId;
}

export function appHistoryLayer(state: unknown): string | null {
  return historyRecord(state)[APP_HISTORY_KEY]?.layerId ?? null;
}

function historyRecord(state: unknown): HistoryRecord {
  return state && typeof state === "object" ? state as HistoryRecord : {};
}

function withMarker(state: HistoryRecord, marker: AppHistoryMarker): HistoryRecord {
  return { ...state, [APP_HISTORY_KEY]: marker };
}

function isPageId(value: unknown): value is PageId {
  return ["today", "calendar", "todos", "habits", "anniversaries", "memos", "focus", "health", "settings", "help"].includes(String(value));
}
