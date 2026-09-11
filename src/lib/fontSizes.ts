export type AppFontSizeId = "compact" | "standard" | "large" | "extra-large";

export interface AppFontSizeOption {
  id: AppFontSizeId;
  name: string;
  description: string;
  scale: number;
}

const STORAGE_KEY = "semester-schedule-font-size-v2";
const LEGACY_STORAGE_KEY = "semester-schedule-font-size-v1";
const CSS_BASE_FONT_SIZE = 16;

export const APP_FONT_SIZES: AppFontSizeOption[] = [
  { id: "compact", name: "偏小", description: "信息更紧凑，适合系统字体较大或希望一屏显示更多内容", scale: 0.8 },
  { id: "standard", name: "标准", description: "推荐的日常字号，兼顾信息密度与可读性", scale: 0.88 },
  { id: "large", name: "偏大", description: "比标准放大约 14%，适合希望更清晰阅读", scale: 1 },
  { id: "extra-large", name: "特大", description: "比标准放大约 27%，适合需要更清晰文字时使用", scale: 1.12 }
];

export const DEFAULT_APP_FONT_SIZE: AppFontSizeId = "standard";

export function loadAppFontSize(): AppFontSizeId {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Some private or restricted WebViews deny storage access entirely.
    return DEFAULT_APP_FONT_SIZE;
  }
  if (isAppFontSizeId(stored)) return stored;

  // The v2 presets are intentionally smaller. Preserve a user who had
  // explicitly selected the old compact preset by moving that choice to the
  // new standard preset, whose visual size is exactly the old compact size.
  let legacy: string | null;
  try {
    legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return DEFAULT_APP_FONT_SIZE;
  }
  const migrated = legacy === "compact"
    ? DEFAULT_APP_FONT_SIZE
    : isAppFontSizeId(legacy) ? legacy : DEFAULT_APP_FONT_SIZE;
  try {
    localStorage.setItem(STORAGE_KEY, migrated);
  } catch {
    // Reading the setting is still useful in restricted/private storage
    // contexts; the next successful save can persist the v2 key.
  }
  return migrated;
}

export function saveAppFontSize(id: AppFontSizeId): AppFontSizeId {
  const normalized = isAppFontSizeId(id) ? id : DEFAULT_APP_FONT_SIZE;
  localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export function appFontSizeLabel(id: AppFontSizeId): string {
  return APP_FONT_SIZES.find((option) => option.id === id)?.name ?? APP_FONT_SIZES[1].name;
}

export function applyAppFontSize(id: AppFontSizeId, root = document.documentElement): AppFontSizeId {
  const normalized = isAppFontSizeId(id) ? id : DEFAULT_APP_FONT_SIZE;
  const option = APP_FONT_SIZES.find((item) => item.id === normalized) ?? APP_FONT_SIZES[1];

  // Android WebView can multiply every CSS font size by the system font scale.
  // Measure that multiplier at 100%, then compensate so the app's four levels
  // have the same visual meaning in APK, installed PWA, and ordinary browser tabs.
  root.style.fontSize = `${CSS_BASE_FONT_SIZE}px`;
  root.style.setProperty("-webkit-text-size-adjust", "100%");
  root.style.setProperty("text-size-adjust", "100%");
  const measuredRootSize = Number.parseFloat(getComputedStyle(root).fontSize);
  const systemScale = Number.isFinite(measuredRootSize) && measuredRootSize > 0
    ? measuredRootSize / CSS_BASE_FONT_SIZE
    : 1;
  const adjustment = Math.min(2, Math.max(0.5, 1 / systemScale));
  const percentage = `${Number((adjustment * 100).toFixed(2))}%`;

  root.dataset.fontSize = normalized;
  root.style.fontSize = `${Number((CSS_BASE_FONT_SIZE * option.scale).toFixed(2))}px`;
  root.style.setProperty("-webkit-text-size-adjust", percentage);
  root.style.setProperty("text-size-adjust", percentage);
  return normalized;
}

export function initializeAppFontSize(): AppFontSizeId {
  const fontSize = loadAppFontSize();
  applyAppFontSize(fontSize);
  return fontSize;
}

function isAppFontSizeId(value: unknown): value is AppFontSizeId {
  return typeof value === "string" && APP_FONT_SIZES.some((option) => option.id === value);
}
