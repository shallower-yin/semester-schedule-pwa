export interface SearchableField {
  field: string;
  label: string;
  value: string | null | undefined;
}

export interface SearchNavigationMatch {
  query: string;
  field: string;
  fieldLabel: string;
  start: number;
  end: number;
  line: number;
  lineStart: number;
  lineEnd: number;
  preview: string;
}

/** Match the line-ending normalization performed by HTML text controls. */
export function normalizeSearchText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Return the first matching field together with stable offsets and its logical line. */
export function findSearchNavigationMatch(
  fields: SearchableField[],
  query: string
): SearchNavigationMatch | null {
  const needle = normalizeSearchText(query).trim();
  if (!needle) return null;
  const matcher = new RegExp(escapeRegExp(needle), "iu");

  for (const candidate of fields) {
    const value = normalizeSearchText(String(candidate.value ?? ""));
    const matched = matcher.exec(value);
    if (!matched) continue;
    const start = matched.index;
    const end = start + matched[0].length;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    return {
      query: needle,
      field: candidate.field,
      fieldLabel: candidate.label,
      start,
      end,
      line: value.slice(0, lineStart).split("\n").length - 1,
      lineStart,
      lineEnd,
      preview: value.slice(lineStart, lineEnd).trim() || needle
    };
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchMatchFieldClass(match: SearchNavigationMatch | null | undefined, field: string): string {
  return match?.field === field ? "search-match-field" : "";
}
