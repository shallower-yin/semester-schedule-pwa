import type { AiAssistantAttachment } from "./assistantAttachments";
import { supabase } from "./supabase";

export interface AiMindMapNode {
  label: string;
  children: AiMindMapNode[];
}

export interface AiMindMapResult {
  answer: string;
  mindMap: AiMindMapNode;
  access?: string;
}

export interface MindMapLayoutNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindMapLayoutEdge {
  id: string;
  from: MindMapLayoutNode;
  to: MindMapLayoutNode;
}

export interface MindMapLayout {
  width: number;
  height: number;
  nodes: MindMapLayoutNode[];
  edges: MindMapLayoutEdge[];
}

const HORIZONTAL_STEP = 230;
const VERTICAL_STEP = 82;
const NODE_HEIGHT = 58;

export async function askAiMindMap(input: {
  prompt: string;
  context?: unknown;
  accessCode?: string;
  attachments?: AiAssistantAttachment[];
}): Promise<AiMindMapResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法生成思维导图。");
  const { data, error } = await supabase.functions.invoke<AiMindMapResult>("ai-assistant", {
    body: {
      mode: "mind_map",
      question: input.prompt.trim(),
      scheduleContext: input.context,
      accessCode: input.accessCode?.trim() || undefined,
      attachments: input.attachments?.slice(0, 3)
    }
  });
  if (error) throw new Error(await mindMapFunctionError(error));
  if (!data?.mindMap?.label) throw new Error("AI 没有返回有效的思维导图。");
  return data;
}

export function buildMindMapLayout(root: AiMindMapNode): MindMapLayout {
  const nodes: MindMapLayoutNode[] = [];
  const edges: MindMapLayoutEdge[] = [];
  let leafIndex = 0;
  let maxDepth = 0;

  function visit(node: AiMindMapNode, depth: number, path: string): MindMapLayoutNode {
    maxDepth = Math.max(maxDepth, depth);
    const children = node.children.map((child, index) => visit(child, depth + 1, `${path}-${index}`));
    const y = children.length
      ? children.reduce((sum, child) => sum + child.y, 0) / children.length
      : 36 + leafIndex++ * VERTICAL_STEP;
    const layoutNode: MindMapLayoutNode = {
      id: path,
      label: node.label,
      depth,
      x: 32 + depth * HORIZONTAL_STEP,
      y,
      width: depth === 0 ? 190 : 176,
      height: NODE_HEIGHT
    };
    nodes.push(layoutNode);
    children.forEach((child) => edges.push({ id: `${path}:${child.id}`, from: layoutNode, to: child }));
    return layoutNode;
  }

  visit(root, 0, "root");
  return {
    width: Math.max(520, 32 + maxDepth * HORIZONTAL_STEP + 230),
    height: Math.max(220, 72 + Math.max(1, leafIndex) * VERTICAL_STEP),
    nodes,
    edges
  };
}

export function splitMindMapLabel(label: string, maxUnits = 14): string[] {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized) return ["未命名"];
  const lines: string[] = [];
  let current = "";
  let units = 0;
  for (const character of normalized) {
    const nextUnits = /[\u0000-\u00ff]/.test(character) ? 0.55 : 1;
    if (current && units + nextUnits > maxUnits) {
      lines.push(current);
      current = character;
      units = nextUnits;
      if (lines.length === 2) break;
    } else {
      current += character;
      units += nextUnits;
    }
  }
  if (current && lines.length < 3) lines.push(current);
  const consumed = lines.join("").length;
  if (consumed < normalized.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, "")}…`;
  return lines.slice(0, 3);
}

export function mindMapToSvg(root: AiMindMapNode): string {
  const layout = buildMindMapLayout(root);
  const edges = layout.edges.map((edge) => {
    const x1 = edge.from.x + edge.from.width;
    const y1 = edge.from.y + edge.from.height / 2;
    const x2 = edge.to.x;
    const y2 = edge.to.y + edge.to.height / 2;
    const control = Math.max(45, (x2 - x1) * 0.45);
    return `<path d="M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}" fill="none" stroke="#aebbd8" stroke-width="2"/>`;
  }).join("");
  const nodes = layout.nodes.map((node) => {
    const colors = node.depth === 0
      ? { fill: "#3157d5", stroke: "#3157d5", text: "#ffffff" }
      : node.depth === 1
        ? { fill: "#edf2ff", stroke: "#9db0ef", text: "#20345f" }
        : { fill: "#ffffff", stroke: "#d8dfec", text: "#27364f" };
    const lines = splitMindMapLabel(node.label);
    const startY = node.y + node.height / 2 - ((lines.length - 1) * 8);
    const text = lines.map((line, index) =>
      `<text x="${node.x + node.width / 2}" y="${startY + index * 17}" text-anchor="middle" dominant-baseline="middle" fill="${colors.text}" font-family="Arial,Microsoft YaHei,sans-serif" font-size="${node.depth === 0 ? 15 : 13}" font-weight="${node.depth <= 1 ? 700 : 600}">${escapeXml(line)}</text>`
    ).join("");
    return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>${text}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><rect width="100%" height="100%" fill="#f7f8fc"/>${edges}${nodes}</svg>`;
}

export function downloadMindMapSvg(root: AiMindMapNode) {
  const blob = new Blob([mindMapToSvg(root)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(root.label)}-思维导图.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function mindMapFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "思维导图生成失败。";
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    } catch {
      // Use the public fallback below.
    }
  }
  return fallback.includes("non-2xx") ? "思维导图生成失败，请稍后重试。" : fallback;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character] ?? character);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "AI脑图";
}
