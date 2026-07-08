export type ThemeSkinId = "default" | "cake" | "linen" | "space" | "cherry" | "peace";

export interface ThemeSkin {
  id: ThemeSkinId;
  name: string;
  description: string;
  colors: [string, string, string];
}

const STORAGE_KEY = "semester-schedule-theme-skin";

export const THEME_SKINS: ThemeSkin[] = [
  { id: "default", name: "默认清爽", description: "干净蓝白，适合长期使用", colors: ["#3157d5", "#f5f7fb", "#ffffff"] },
  { id: "cake", name: "蛋糕物语", description: "粉紫糖霜和奶油感卡片", colors: ["#f47aa5", "#f4e8ff", "#fff7fb"] },
  { id: "linen", name: "素色如锦", description: "柔和米白和植物绿", colors: ["#7aa874", "#f7f1e6", "#fffdf7"] },
  { id: "space", name: "太空宇航人", description: "浅紫星空和安静蓝", colors: ["#6c63ff", "#ecebff", "#f8f7ff"] },
  { id: "cherry", name: "樱桃啵啵", description: "樱粉、浅红和软糖色", colors: ["#ef6f8f", "#fff0f4", "#fff9fb"] },
  { id: "peace", name: "平安喜乐", description: "喜庆红与暖金点缀", colors: ["#9e1f2f", "#fff1dc", "#fffaf2"] }
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

function isThemeSkinId(value: unknown): value is ThemeSkinId {
  return typeof value === "string" && THEME_SKINS.some((skin) => skin.id === value);
}
