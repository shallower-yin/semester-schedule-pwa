export type MemoLineFormat = "numbered" | "checklist";

interface MemoTextEdit {
  content: string;
  cursor: number;
}

const uncheckedCircle = "○";
const checkedCircle = "●";

export function applyMemoLineFormat(content: string, selectionStart: number, selectionEnd: number, kind: MemoLineFormat): MemoTextEdit {
  const start = clamp(selectionStart, 0, content.length);
  const end = clamp(selectionEnd, 0, content.length);
  if (start !== end) return formatSelectedLines(content, Math.min(start, end), Math.max(start, end), kind);

  const marker = kind === "numbered" ? `${nextNumberBefore(content, start)}. ` : `${uncheckedCircle} `;
  if (!content) return { content: marker, cursor: marker.length };

  const lineStart = findLineStart(content, start);
  const lineEnd = findLineEnd(content, start);
  const line = content.slice(lineStart, lineEnd);
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const stripped = stripMemoListPrefix(line).trimStart();
  const replacement = stripped ? `${indent}${marker}${stripped}` : `${indent}${marker}`;
  const nextContent = `${content.slice(0, lineStart)}${replacement}${content.slice(lineEnd)}`;
  const cursor = stripped
    ? Math.min(start + marker.length, lineStart + replacement.length)
    : lineStart + replacement.length;

  return { content: nextContent, cursor };
}

export function continueMemoListOnEnter(content: string, selectionStart: number, selectionEnd: number): MemoTextEdit | null {
  const start = clamp(selectionStart, 0, content.length);
  const end = clamp(selectionEnd, 0, content.length);
  if (start !== end) return null;

  const lineStart = findLineStart(content, start);
  const currentLine = content.slice(lineStart, start);
  const numbered = /^(\s*)(\d+)[.)、]\s*(.*)$/.exec(currentLine);
  if (numbered) {
    const text = numbered[3].trim();
    if (!text) return removeCurrentListMarker(content, lineStart, start);
    const insert = `\n${numbered[1]}${Number(numbered[2]) + 1}. `;
    return insertAtCursor(content, start, insert);
  }

  const circleTodo = new RegExp(`^(\\s*)[${uncheckedCircle}◯${checkedCircle}]\\s*(.*)$`).exec(currentLine);
  if (circleTodo) {
    const text = circleTodo[2].trim();
    if (!text) return removeCurrentListMarker(content, lineStart, start);
    return insertAtCursor(content, start, `\n${circleTodo[1]}${uncheckedCircle} `);
  }

  const markdownTodo = /^(\s*)[-*]\s+\[( |x|X)\]\s*(.*)$/.exec(currentLine);
  if (markdownTodo) {
    const text = markdownTodo[3].trim();
    if (!text) return removeCurrentListMarker(content, lineStart, start);
    return insertAtCursor(content, start, `\n${markdownTodo[1]}- [ ] `);
  }

  return null;
}

export function toggleMemoChecklistAtCursor(content: string, cursor: number): MemoTextEdit | null {
  const position = clamp(cursor, 0, content.length);
  const lineStart = findLineStart(content, position);
  const lineEnd = findLineEnd(content, position);
  const line = content.slice(lineStart, lineEnd);

  const circleTodo = new RegExp(`^(\\s*)([${uncheckedCircle}◯${checkedCircle}])(\\s*)`).exec(line);
  if (circleTodo) {
    const markerStart = lineStart + circleTodo[1].length;
    const markerClickEnd = markerStart + circleTodo[2].length + circleTodo[3].length;
    if (!isMarkerClick(position, lineStart, markerClickEnd)) return null;
    const nextMarker = circleTodo[2] === checkedCircle ? uncheckedCircle : checkedCircle;
    return replaceRange(content, markerStart, markerStart + circleTodo[2].length, nextMarker, position);
  }

  const markdownTodo = /^(\s*[-*]\s+\[)( |x|X)(\]\s*)/.exec(line);
  if (markdownTodo) {
    const markerStart = lineStart + markdownTodo[1].length;
    const markerClickEnd = markerStart + markdownTodo[2].length + markdownTodo[3].length;
    if (!isMarkerClick(position, lineStart, markerClickEnd)) return null;
    const nextMarker = markdownTodo[2].toLowerCase() === "x" ? " " : "x";
    return replaceRange(content, markerStart, markerStart + markdownTodo[2].length, nextMarker, position);
  }

  return null;
}

export function stripMemoListPrefix(line: string): string {
  return line.replace(/^\s*(?:\d+[.)、]|[-*]\s+\[[ xX]\]|[-*]|[○◯●])\s*/, "");
}

function formatSelectedLines(content: string, start: number, end: number, kind: MemoLineFormat): MemoTextEdit {
  const rangeStart = findLineStart(content, start);
  const rangeEnd = findLineEnd(content, end);
  const target = content.slice(rangeStart, rangeEnd);
  let number = 1;
  const transformed = target.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const text = stripMemoListPrefix(line).trimStart();
    if (!text) return line;
    if (kind === "numbered") return `${indent}${number++}. ${text}`;
    return `${indent}${uncheckedCircle} ${text}`;
  }).join("\n");
  const nextContent = `${content.slice(0, rangeStart)}${transformed}${content.slice(rangeEnd)}`;

  return { content: nextContent, cursor: rangeStart + transformed.length };
}

function removeCurrentListMarker(content: string, lineStart: number, cursor: number): MemoTextEdit {
  const nextContent = `${content.slice(0, lineStart)}${content.slice(cursor)}`;
  return { content: nextContent, cursor: lineStart };
}

function insertAtCursor(content: string, cursor: number, insert: string): MemoTextEdit {
  return {
    content: `${content.slice(0, cursor)}${insert}${content.slice(cursor)}`,
    cursor: cursor + insert.length
  };
}

function replaceRange(content: string, start: number, end: number, replacement: string, cursor: number): MemoTextEdit {
  return {
    content: `${content.slice(0, start)}${replacement}${content.slice(end)}`,
    cursor: clamp(cursor, start, start + replacement.length)
  };
}

function isMarkerClick(cursor: number, lineStart: number, markerClickEnd: number): boolean {
  return cursor >= lineStart && cursor <= markerClickEnd;
}

function nextNumberBefore(content: string, cursor: number): number {
  const previousLines = content.slice(0, cursor).split(/\r?\n/).reverse();
  for (const line of previousLines) {
    const match = /^\s*(\d+)[.)、]\s+/.exec(line);
    if (match) return Number(match[1]) + 1;
  }
  return 1;
}

function findLineStart(content: string, cursor: number): number {
  return content.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
}

function findLineEnd(content: string, cursor: number): number {
  const lineEnd = content.indexOf("\n", cursor);
  return lineEnd === -1 ? content.length : lineEnd;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
