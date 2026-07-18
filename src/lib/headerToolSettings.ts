export type HeaderToolId = "account" | "scheduleAssistant" | "aiAssistant" | "mindMap" | "audioTranscription" | "quickEntry" | "search";

const STORAGE_KEY = "semester-schedule-header-tools-v2";
const LEGACY_STORAGE_KEY = "semester-schedule-header-tools";

export const DEFAULT_HEADER_TOOLS: HeaderToolId[] = ["account", "scheduleAssistant", "aiAssistant", "quickEntry", "search"];
export const AVAILABLE_HEADER_TOOLS: HeaderToolId[] = ["account", "scheduleAssistant", "aiAssistant", "mindMap", "audioTranscription", "quickEntry", "search"];

export function loadHeaderToolSettings(): HeaderToolId[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return migrateLegacyHeaderToolSettings();
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_HEADER_TOOLS];
    const valid = parsed.filter((item): item is HeaderToolId =>
      typeof item === "string" && AVAILABLE_HEADER_TOOLS.includes(item as HeaderToolId)
    );
    return Array.from(new Set(valid));
  } catch {
    return [...DEFAULT_HEADER_TOOLS];
  }
}

export function saveHeaderToolSettings(items: HeaderToolId[]): HeaderToolId[] {
  const next = Array.from(new Set(items.filter((item) => AVAILABLE_HEADER_TOOLS.includes(item))));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function migrateLegacyHeaderToolSettings(): HeaderToolId[] {
  const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null") as unknown;
  const next = Array.isArray(parsed)
    ? Array.from(new Set(parsed.filter((item): item is HeaderToolId =>
      typeof item === "string" && DEFAULT_HEADER_TOOLS.includes(item as HeaderToolId)
    )))
    : [...DEFAULT_HEADER_TOOLS];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
