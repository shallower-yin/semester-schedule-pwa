import type { PageId } from "../types";

const STORAGE_KEY = "semester-schedule-mobile-nav";
export const AVAILABLE_MOBILE_NAV: PageId[] = ["today", "calendar", "todos", "habits", "anniversaries", "memos", "focus", "health", "settings", "help"];
export const DEFAULT_MOBILE_NAV: PageId[] = ["today", "calendar", "memos", "focus", "settings"];

export function loadMobileNavSettings(): PageId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_MOBILE_NAV;
    const valid = parsed.filter((item): item is PageId => AVAILABLE_MOBILE_NAV.includes(item as PageId));
    const unique = Array.from(new Set(valid));
    return unique.length ? unique : DEFAULT_MOBILE_NAV;
  } catch {
    return DEFAULT_MOBILE_NAV;
  }
}

export function saveMobileNavSettings(items: PageId[]): PageId[] {
  const next = Array.from(new Set(items.filter((item) => AVAILABLE_MOBILE_NAV.includes(item))));
  const normalized = next.length ? next : DEFAULT_MOBILE_NAV;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
