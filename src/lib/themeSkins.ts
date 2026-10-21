export type ThemeSkinId = "default" | "cake" | "linen" | "space" | "cherry" | "peace";

export interface ThemeSkin {
  id: ThemeSkinId;
  name: string;
  description: string;
  themeColor: string;
  /** Shared with schedule image export: accent foreground, canvas, surface. */
  colors: [string, string, string];
}

const STORAGE_KEY = "semester-schedule-theme-skin";

export const THEME_SKINS: ThemeSkin[] = [
  { id: "default", name: "晴空蓝", description: "浅蓝背景、蓝色强调", themeColor: "#eef7ff", colors: ["#3973a6", "#eef7ff", "#ffffff"] },
  { id: "cake", name: "奶杏橙", description: "奶杏背景、暖橙强调", themeColor: "#fff6ed", colors: ["#ae5d38", "#fff6ed", "#fffefd"] },
  { id: "linen", name: "薄荷绿", description: "浅绿背景、薄荷强调", themeColor: "#effbf6", colors: ["#388060", "#effbf6", "#fcfffd"] },
  { id: "space", name: "雾紫", description: "浅紫背景、雾紫强调", themeColor: "#f6f2ff", colors: ["#6f55ad", "#f6f2ff", "#fffefe"] },
  { id: "cherry", name: "樱花粉", description: "浅粉背景、樱粉强调", themeColor: "#fff3f5", colors: ["#b0506c", "#fff3f5", "#fffdfd"] },
  { id: "peace", name: "奶油黄", description: "奶黄背景、暖金强调", themeColor: "#fffbee", colors: ["#91702c", "#fffbee", "#fffefa"] }
];

export const DEFAULT_THEME_SKIN: ThemeSkinId = "default";

export function loadThemeSkin(): ThemeSkinId {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeSkinId | null;
  return isThemeSkinId(stored) ? stored : DEFAULT_THEME_SKIN;
}

export function saveThemeSkin(id: ThemeSkinId): ThemeSkinId {
  const normalized = isThemeSkinId(id) ? id : DEFAULT_THEME_SKIN;
  localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export function themeSkinLabel(id: ThemeSkinId): string {
  return THEME_SKINS.find((skin) => skin.id === id)?.name ?? THEME_SKINS[0].name;
}

export function themeSkinColor(id: ThemeSkinId): string {
  return THEME_SKINS.find((skin) => skin.id === id)?.themeColor ?? THEME_SKINS[0].themeColor;
}

/** Keep portal variables and the browser/PWA title bar aligned with the selected skin. */
export function applyDocumentThemeSkin(id: ThemeSkinId): () => void {
  const root = document.documentElement;
  const previous = root.dataset.skin;
  let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const createdThemeColorMeta = !themeColorMeta;
  if (!themeColorMeta) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.name = "theme-color";
    document.head.append(themeColorMeta);
  }
  const previousThemeColor = themeColorMeta.content;
  const nextThemeColor = themeSkinColor(id);
  root.dataset.skin = id;
  themeColorMeta.content = nextThemeColor;
  return () => {
    if (root.dataset.skin === id) {
      if (previous) root.dataset.skin = previous;
      else delete root.dataset.skin;
    }
    if (themeColorMeta?.content !== nextThemeColor) return;
    if (createdThemeColorMeta) themeColorMeta.remove();
    else themeColorMeta.content = previousThemeColor;
  };
}

function isThemeSkinId(value: unknown): value is ThemeSkinId {
  return typeof value === "string" && THEME_SKINS.some((skin) => skin.id === value);
}
