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

export type MindMapDepth = "quick" | "standard" | "deep";

export interface MindMapLayoutNode {
  id: string;
  label: string;
  depth: number;
  side: -1 | 0 | 1;
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
const ROOT_WIDTH = 190;
const NODE_WIDTH = 176;
const CANVAS_MARGIN = 44;

export async function askAiMindMap(input: {
  prompt: string;
  context?: unknown;
  accessCode?: string;
  attachments?: AiAssistantAttachment[];
  depth?: MindMapDepth;
}): Promise<AiMindMapResult> {
  if (!supabase) throw new Error("云端服务未配置，暂时无法生成思维导图。");
  let lastError = "思维导图生成失败，请稍后重试。";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.functions.invoke<AiMindMapResult>("ai-assistant", {
      body: {
        mode: "mind_map",
        question: input.prompt.trim(),
        scheduleContext: input.context,
        accessCode: input.accessCode?.trim() || undefined,
        attachments: input.attachments?.slice(0, 3),
        mindMapDepth: input.depth ?? "standard"
      }
    });
    if (!error && data?.mindMap?.label) return data;
    lastError = error ? await mindMapFunctionError(error) : "AI 没有返回有效的思维导图。";
    if (attempt === 0 && mindMapErrorCanRetry(lastError)) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      continue;
    }
    break;
  }
  throw new Error(lastError);
}

export function mindMapNeedsScheduleContext(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, "");
  if (!normalized) return false;
  return /(日程|课程|课表|上课|事项|待办|安排|习惯|纪念日|生日|节日|备忘录|专注|番茄钟|冲突|空闲|未完成|逾期|学期|第\d+周|今天|今日|明天|后天|本周|这周|下周|本月|下月|周[一二三四五六日天]|星期[一二三四五六日天])/.test(normalized);
}

export function buildMindMapLayout(root: AiMindMapNode): MindMapLayout {
  const nodes: MindMapLayoutNode[] = [];
  const edges: MindMapLayoutEdge[] = [];
  const branchSides = balanceRootBranches(root.children);
  const maxDepth = Math.max(1, ...root.children.map((child) => treeDepth(child)));
  const leftBranches = root.children.flatMap((child, index) => branchSides[index] === -1 ? [{ child, index }] : []);
  const rightBranches = root.children.flatMap((child, index) => branchSides[index] === 1 ? [{ child, index }] : []);
  const leftLeaves = Math.max(1, leftBranches.reduce((sum, item) => sum + leafCount(item.child), 0));
  const rightLeaves = Math.max(1, rightBranches.reduce((sum, item) => sum + leafCount(item.child), 0));
  const maxLeaves = Math.max(leftLeaves, rightLeaves);
  const height = Math.max(260, CANVAS_MARGIN * 2 + (maxLeaves - 1) * VERTICAL_STEP + NODE_HEIGHT);
  const width = Math.max(760, 2 * (CANVAS_MARGIN + maxDepth * HORIZONTAL_STEP + NODE_WIDTH / 2));
  const rootCenterX = width / 2;
  const rootCenterY = height / 2;

  function layoutSide(branches: Array<{ child: AiMindMapNode; index: number }>, side: -1 | 1, sideLeaves: number) {
    let leafIndex = 0;
    const verticalOffset = CANVAS_MARGIN + (maxLeaves - sideLeaves) * VERTICAL_STEP / 2;

    function visit(node: AiMindMapNode, depth: number, path: string): MindMapLayoutNode {
      const children = node.children.map((child, index) => visit(child, depth + 1, `${path}-${index}`));
      const centerY = children.length
        ? children.reduce((sum, child) => sum + child.y + child.height / 2, 0) / children.length
        : verticalOffset + NODE_HEIGHT / 2 + leafIndex++ * VERTICAL_STEP;
      const centerX = rootCenterX + side * depth * HORIZONTAL_STEP;
      const layoutNode: MindMapLayoutNode = {
        id: path,
        label: node.label,
        depth,
        side,
        x: centerX - NODE_WIDTH / 2,
        y: centerY - NODE_HEIGHT / 2,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      };
      nodes.push(layoutNode);
      children.forEach((child) => edges.push({ id: `${path}:${child.id}`, from: layoutNode, to: child }));
      return layoutNode;
    }

    return branches.map(({ child, index }) => visit(child, 1, `root-${index}`));
  }

  const leftNodes = layoutSide(leftBranches, -1, leftLeaves);
  const rightNodes = layoutSide(rightBranches, 1, rightLeaves);
  const rootNode: MindMapLayoutNode = {
    id: "root",
    label: root.label,
    depth: 0,
    side: 0,
    x: rootCenterX - ROOT_WIDTH / 2,
    y: rootCenterY - NODE_HEIGHT / 2,
    width: ROOT_WIDTH,
    height: NODE_HEIGHT
  };
  nodes.push(rootNode);
  [...leftNodes, ...rightNodes].forEach((child) => edges.push({ id: `root:${child.id}`, from: rootNode, to: child }));

  return {
    width,
    height,
    nodes,
    edges
  };
}

export function mindMapEdgePath(edge: MindMapLayoutEdge): string {
  const side = edge.to.side || edge.from.side || 1;
  const x1 = side === 1 ? edge.from.x + edge.from.width : edge.from.x;
  const y1 = edge.from.y + edge.from.height / 2;
  const x2 = side === 1 ? edge.to.x : edge.to.x + edge.to.width;
  const y2 = edge.to.y + edge.to.height / 2;
  const control = Math.max(45, Math.abs(x2 - x1) * 0.45);
  return side === 1
    ? `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${x1 - control} ${y1}, ${x2 + control} ${y2}, ${x2} ${y2}`;
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
  const edges = layout.edges.map((edge) =>
    `<path d="${mindMapEdgePath(edge)}" fill="none" stroke="#aebbd8" stroke-width="2"/>`
  ).join("");
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
  downloadBlob(blob, `${safeFileName(root.label)}-思维导图.svg`);
}

export async function downloadMindMapPng(root: AiMindMapNode): Promise<void> {
  const layout = buildMindMapLayout(root);
  const maxDimension = 4096;
  const scale = Math.min(2, maxDimension / layout.width, maxDimension / layout.height);
  const width = Math.max(1, Math.round(layout.width * scale));
  const height = Math.max(1, Math.round(layout.height * scale));
  const source = new Blob([mindMapToSvg(root)], { type: "image/svg+xml;charset=utf-8" });
  const sourceUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法生成 PNG 图片。");
    context.fillStyle = "#f7f8fc";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${safeFileName(root.label)}-思维导图.png`);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
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

function mindMapErrorCanRetry(message: string): boolean {
  return /(网络|连接|暂时不可用|稍后重试|格式无效|没有返回有效)/.test(message)
    && !/(额度|权限|登录|访问口令)/.test(message);
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

function leafCount(node: AiMindMapNode): number {
  if (!node.children.length) return 1;
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

function treeDepth(node: AiMindMapNode): number {
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map(treeDepth));
}

function balanceRootBranches(children: AiMindMapNode[]): Array<-1 | 1> {
  let leftWeight = 0;
  let rightWeight = 0;
  return children.map((child, index) => {
    const weight = leafCount(child);
    const side: -1 | 1 = index === 0 || leftWeight <= rightWeight ? -1 : 1;
    if (side === -1) leftWeight += weight;
    else rightWeight += weight;
    return side;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("思维导图图片渲染失败。"));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 图片生成失败。")), "image/png", 0.95);
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
