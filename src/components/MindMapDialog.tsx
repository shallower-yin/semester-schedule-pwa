import { Download, FileText, Image as ImageIcon, KeyRound, Minus, Network, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AI_DOCUMENT_ACCEPT, AI_IMAGE_ACCEPT, prepareAiAssistantAttachment, type AiAssistantAttachment } from "../lib/assistantAttachments";
import { buildDeepSeekScheduleContext, getAiAssistantConfiguration, type AiAssistantConfiguration } from "../lib/deepSeekAssistant";
import { askAiMindMap, buildMindMapLayout, downloadMindMapPng, downloadMindMapSvg, mindMapEdgePath, splitMindMapLabel, type AiMindMapNode } from "../lib/mindMap";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { showToast } from "../lib/toast";
import { AttachmentSourcePicker } from "./AttachmentSourcePicker";
import { Modal } from "./Modal";

interface MindMapDialogProps {
  input: ScheduleAssistantInput;
  ownerId: string;
  onClose: () => void;
}

const EXAMPLES = ["梳理本周学习计划", "整理项目方案", "总结附件知识点"];

export function MindMapDialog({ input, ownerId, onClose }: MindMapDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [mindMap, setMindMap] = useState<AiMindMapNode | null>(() => loadMindMap(ownerId));
  const [attachments, setAttachments] = useState<AiAssistantAttachment[]>([]);
  const [configuration, setConfiguration] = useState<AiAssistantConfiguration>({ provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false });
  const [loading, setLoading] = useState(false);
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    void getAiAssistantConfiguration().then(setConfiguration);
  }, []);

  useEffect(() => {
    setMindMap(loadMindMap(ownerId));
  }, [ownerId]);

  async function addAttachments(files: FileList | null) {
    if (!files?.length || !configuration.supportsAttachments) return;
    setPreparingAttachment(true);
    try {
      const available = Math.max(0, 3 - attachments.length);
      const prepared = await Promise.all(Array.from(files).slice(0, available).map(prepareAiAssistantAttachment));
      setAttachments((current) => [...current, ...prepared].slice(0, 3));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "读取附件失败。", "error");
    } finally {
      setPreparingAttachment(false);
    }
  }

  async function generate() {
    const question = prompt.trim() || (attachments.length ? "请根据附件内容生成一份结构清晰的思维导图。" : "");
    if (!question || loading) return;
    setLoading(true);
    try {
      const result = await askAiMindMap({
        prompt: question,
        context: buildDeepSeekScheduleContext(input, question),
        accessCode,
        attachments
      });
      setMindMap(result.mindMap);
      localStorage.setItem(mindMapStorageKey(ownerId), JSON.stringify(result.mindMap));
      setZoom(1);
      if (result.access === "access-code") setAccessCode("");
      showToast("思维导图已生成。", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "思维导图生成失败。", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="AI 思维导图"
      onClose={onClose}
      wide
      className="mind-map-modal"
      headerExtra={(
        <label className="ai-header-access-code">
          <KeyRound size={14} />
          <input value={accessCode} placeholder="访问口令" aria-label="脑图访问口令" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
      )}
    >
      <div className="mind-map-dialog">
        <section className="mind-map-composer">
          <label>主题或内容
            <textarea
              value={prompt}
              maxLength={6000}
              placeholder="输入要梳理的主题、课程内容或项目方案，也可以导入图片和文档"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="mind-map-examples">
            {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setPrompt(example)}>{example}</button>)}
          </div>
          {attachments.length > 0 && (
            <div className="assistant-attachments">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`}>
                  {attachment.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  <strong>{attachment.name}</strong>
                  <button type="button" className="icon-button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="mind-map-composer-actions">
            {configuration.supportsAttachments && (
              <AttachmentSourcePicker
                imageAccept={AI_IMAGE_ACCEPT}
                documentAccept={AI_DOCUMENT_ACCEPT}
                label={preparingAttachment ? "读取中" : `附件 ${attachments.length}/3`}
                ariaLabel="选择脑图附件来源"
                disabled={loading || preparingAttachment || attachments.length >= 3}
                onFiles={addAttachments}
              />
            )}
            <button type="button" className="button primary" disabled={loading || (!prompt.trim() && attachments.length === 0)} onClick={() => void generate()}>
              <Sparkles size={16} />{loading ? "生成中…" : "生成脑图"}
            </button>
          </div>
        </section>

        <section className="mind-map-result" aria-label="思维导图结果">
          {mindMap ? (
            <>
              <div className="mind-map-result-toolbar">
                <div><Network size={18} /><span><strong>{mindMap.label}</strong><small>可拖动滚动区域查看完整结构</small></span></div>
                <div>
                  <button type="button" className="icon-button" aria-label="缩小脑图" onClick={() => setZoom((current) => Math.max(0.65, current - 0.1))}><Minus size={16} /></button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" className="icon-button" aria-label="放大脑图" onClick={() => setZoom((current) => Math.min(1.5, current + 0.1))}><Plus size={16} /></button>
                  <button type="button" className="button secondary compact" onClick={() => downloadMindMapSvg(mindMap)}><Download size={15} />SVG</button>
                  <button type="button" className="button secondary compact" onClick={() => void downloadMindMapPng(mindMap)}><Download size={15} />PNG</button>
                </div>
              </div>
              <MindMapCanvas root={mindMap} zoom={zoom} />
            </>
          ) : (
            <div className="mind-map-empty"><Network size={42} /><strong>输入主题后生成思维导图</strong><span>AI 会提炼中心主题、主要分支和关键节点。</span></div>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function MindMapCanvas({ root, zoom }: { root: AiMindMapNode; zoom: number }) {
  const layout = useMemo(() => buildMindMapLayout(root), [root]);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const rootNode = layout.nodes.find((node) => node.side === 0);
    if (!viewport || !rootNode) return;
    let frame = 0;
    const centerRoot = () => {
      const rootCenter = (rootNode.x + rootNode.width / 2) * zoom;
      viewport.scrollLeft = Math.max(0, rootCenter - viewport.clientWidth / 2);
    };
    const scheduleCenter = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(centerRoot);
    };
    scheduleCenter();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleCenter);
    observer?.observe(viewport);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [layout, zoom]);

  return (
    <div ref={viewportRef} className="mind-map-viewport">
      <svg
        className="mind-map-canvas"
        width={layout.width * zoom}
        height={layout.height * zoom}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`${root.label} 思维导图`}
      >
        {layout.edges.map((edge) => {
          return <path key={edge.id} d={mindMapEdgePath(edge)} />;
        })}
        {layout.nodes.map((node) => {
          const lines = splitMindMapLabel(node.label);
          const startY = node.y + node.height / 2 - ((lines.length - 1) * 8);
          return (
            <g key={node.id} className={`mind-map-node depth-${Math.min(node.depth, 3)}`}>
              <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} />
              <text x={node.x + node.width / 2} y={startY} textAnchor="middle">
                {lines.map((line, index) => <tspan key={`${node.id}-${index}`} x={node.x + node.width / 2} dy={index === 0 ? 0 : 17}>{line}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function mindMapStorageKey(ownerId: string): string {
  return `semester-schedule-mind-map:${ownerId}`;
}

function loadMindMap(ownerId: string): AiMindMapNode | null {
  try {
    const saved = JSON.parse(localStorage.getItem(mindMapStorageKey(ownerId)) ?? "null") as AiMindMapNode | null;
    return saved?.label ? saved : null;
  } catch {
    return null;
  }
}
