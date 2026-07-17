import type { PageId } from "../types";

const APP_HISTORY_KEY = "__semesterSchedule";

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
  return ["today", "calendar", "habits", "anniversaries", "memos", "focus", "settings", "help"].includes(String(value));
}
