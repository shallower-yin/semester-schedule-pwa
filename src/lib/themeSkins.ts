export type ThemeSkinId = "default" | "cake" | "linen" | "space" | "cherry" | "peace";

export interface ThemeSkin {
  id: ThemeSkinId;
  name: string;
  description: string;
  themeColor: string;
  colors: [string, string, string];
}

const STORAGE_KEY = "semester-schedule-theme-skin";

export const THEME_SKINS: ThemeSkin[] = [
  { id: "default", name: "默认清爽", description: "干净蓝白，适合长期使用", themeColor: "#3157d5", colors: ["#3157d5", "#f5f7fb", "#ffffff"] },
  { id: "cake", name: "蛋糕物语", description: "粉紫糖霜和奶油感卡片", themeColor: "#b83275", colors: ["#f47aa5", "#f4e8ff", "#fff7fb"] },
  { id: "linen", name: "素色如锦", description: "柔和米白和植物绿", themeColor: "#477342", colors: ["#7aa874", "#f7f1e6", "#fffdf7"] },
  { id: "space", name: "太空宇航人", description: "浅紫星空和安静蓝", themeColor: "#6863d9", colors: ["#6c63ff", "#ecebff", "#f8f7ff"] },
  { id: "cherry", name: "樱桃啵啵", description: "樱粉、浅红和软糖色", themeColor: "#b43d60", colors: ["#ef6f8f", "#fff0f4", "#fff9fb"] },
  { id: "peace", name: "平安喜乐", description: "喜庆红与暖金点缀", themeColor: "#9e1f2f", colors: ["#9e1f2f", "#fff1dc", "#fffaf2"] }
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
