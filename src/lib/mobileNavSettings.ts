import type { PageId } from "../types";

const STORAGE_KEY = "semester-schedule-mobile-nav";
const LEGACY_DEFAULT_MOBILE_NAV: PageId[][] = [
  ["today", "calendar", "habits", "anniversaries", "memos", "focus", "settings"],
  ["today", "calendar", "habits", "anniversaries", "memos", "focus", "health", "settings"]
];
export const AVAILABLE_MOBILE_NAV: PageId[] = ["today", "calendar", "habits", "anniversaries", "memos", "focus", "health", "settings", "help"];
export const DEFAULT_MOBILE_NAV: PageId[] = [...AVAILABLE_MOBILE_NAV];

export function loadMobileNavSettings(): PageId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_MOBILE_NAV;
    const valid = parsed.filter((item): item is PageId => AVAILABLE_MOBILE_NAV.includes(item as PageId));
    const unique = Array.from(new Set(valid));
    if (LEGACY_DEFAULT_MOBILE_NAV.some((defaults) => sameItems(unique, defaults))) {
      return DEFAULT_MOBILE_NAV;
    }
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

function sameItems(left: PageId[], right: PageId[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
