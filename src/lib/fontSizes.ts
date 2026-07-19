export type AppFontSizeId = "compact" | "standard" | "large" | "extra-large";

export interface AppFontSizeOption {
  id: AppFontSizeId;
  name: string;
  description: string;
  scale: number;
}

const STORAGE_KEY = "semester-schedule-font-size-v1";
const CSS_BASE_FONT_SIZE = 16;
const originalRuleFontSizes = new WeakMap<CSSStyleDeclaration, number>();

export const APP_FONT_SIZES: AppFontSizeOption[] = [
  { id: "compact", name: "偏小", description: "信息更紧凑，适合系统字体已经调大的设备", scale: 0.88 },
  { id: "standard", name: "标准", description: "按应用设计字号显示，并自动抵消浏览器额外放大", scale: 1 },
  { id: "large", name: "偏大", description: "文字放大约 12%，按钮和卡片尺寸保持不变", scale: 1.12 },
  { id: "extra-large", name: "特大", description: "文字放大约 25%，适合需要更清晰文字时使用", scale: 1.25 }
];

export const DEFAULT_APP_FONT_SIZE: AppFontSizeId = "standard";

export function loadAppFontSize(): AppFontSizeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isAppFontSizeId(stored) ? stored : DEFAULT_APP_FONT_SIZE;
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
  applyStylesheetFontScale(option.scale);
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

function applyStylesheetFontScale(scale: number) {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    applyRuleListFontScale(rules, scale);
  }
}

function applyRuleListFontScale(rules: CSSRuleList, scale: number) {
  for (const rule of Array.from(rules)) {
    const style = "style" in rule ? (rule as CSSStyleRule).style : null;
    if (style) {
      const current = style.getPropertyValue("font-size").trim();
      const numeric = /^(-?\d+(?:\.\d+)?)px$/.exec(current);
      const base = originalRuleFontSizes.get(style) ?? (numeric ? Number(numeric[1]) : null);
      if (base !== null && Number.isFinite(base)) {
        originalRuleFontSizes.set(style, base);
        style.setProperty("font-size", `${Number((base * scale).toFixed(3))}px`);
      }
    }

    if ("cssRules" in rule) {
      applyRuleListFontScale((rule as CSSMediaRule).cssRules, scale);
    }
  }
}
