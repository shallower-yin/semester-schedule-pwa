export type HeaderToolId = "account" | "scheduleAssistant" | "aiAssistant" | "mindMap" | "audioTranscription" | "quickEntry" | "search";

const STORAGE_KEY = "semester-schedule-header-tools";
const PREVIOUS_DEFAULT_HEADER_TOOL_SETS: HeaderToolId[][] = [
  ["account", "scheduleAssistant", "aiAssistant", "quickEntry", "search"],
  ["account", "scheduleAssistant", "aiAssistant", "mindMap", "quickEntry", "search"]
];

export const DEFAULT_HEADER_TOOLS: HeaderToolId[] = ["account", "scheduleAssistant", "aiAssistant", "mindMap", "audioTranscription", "quickEntry", "search"];

export function loadHeaderToolSettings(): HeaderToolId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_HEADER_TOOLS;
    const valid = parsed.filter((item): item is HeaderToolId => DEFAULT_HEADER_TOOLS.includes(item as HeaderToolId));
    if (PREVIOUS_DEFAULT_HEADER_TOOL_SETS.some((previous) =>
      valid.length === previous.length && previous.every((item, index) => valid[index] === item)
    )) {
      return DEFAULT_HEADER_TOOLS;
    }
    return Array.from(new Set(valid));
  } catch {
    return DEFAULT_HEADER_TOOLS;
  }
}

export function saveHeaderToolSettings(items: HeaderToolId[]): HeaderToolId[] {
  const next = Array.from(new Set(items.filter((item) => DEFAULT_HEADER_TOOLS.includes(item))));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
