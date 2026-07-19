import { Download, Eye, FileText, Image as ImageIcon, KeyRound, Minus, Network, Plus, Send, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent as ReactClipboardEvent } from "react";
import { AI_DOCUMENT_ACCEPT, AI_IMAGE_ACCEPT, prepareAiAssistantAttachment, releaseAiAssistantAttachments, type AiAssistantAttachment } from "../lib/assistantAttachments";
import { cancelAiTask, getAiTaskSnapshot, retryAiTask, setAiTaskDialogOpen, startAiTask, subscribeAiTasks } from "../lib/aiBackgroundTasks";
import { extractClipboardFiles } from "../lib/clipboardFiles";
import { buildDeepSeekScheduleContext, getAiAssistantConfiguration, type AiAssistantConfiguration } from "../lib/deepSeekAssistant";
import { askAiMindMap, askAiMindMapFollowup, buildMindMapLayout, downloadMindMapPng, downloadMindMapSvg, mindMapEdgePath, mindMapNeedsScheduleContext, mindMapToSvg, splitMindMapLabel, type AiMindMapFollowupMessage, type AiMindMapNode, type MindMapDepth } from "../lib/mindMap";
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

interface MindMapFollowupTurn {
  question: string;
  answer: string;
}

export function MindMapDialog({ input, ownerId, onClose }: MindMapDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [mindMap, setMindMap] = useState<AiMindMapNode | null>(() => loadMindMap(ownerId));
  const [attachments, setAttachments] = useState<AiAssistantAttachment[]>([]);
  const [configuration, setConfiguration] = useState<AiAssistantConfiguration>({ provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false });
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [zoom, setZoom] = useState(1);
  const [depth, setDepth] = useState<MindMapDepth>("standard");
  const [previewing, setPreviewing] = useState(false);
  const [followupQuestion, setFollowupQuestion] = useState("");
  const [followupTurns, setFollowupTurns] = useState<MindMapFollowupTurn[]>([]);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState("");
  const followupControllerRef = useRef<AbortController | null>(null);
  const task = useSyncExternalStore(subscribeAiTasks, () => getAiTaskSnapshot("mind_map"), () => getAiTaskSnapshot("mind_map"));
  const loading = task.status === "running";
  useEffect(() => {
    void getAiAssistantConfiguration().then(setConfiguration);
  }, []);

  useEffect(() => {
    setMindMap(loadMindMap(ownerId));
    setFollowupTurns([]);
    setFollowupError("");
  }, [ownerId]);

  useEffect(() => {
    setAiTaskDialogOpen("mind_map", true);
    return () => {
      setAiTaskDialogOpen("mind_map", false);
      followupControllerRef.current?.abort();
    };
  }, []);

  async function addAttachments(files: FileList | readonly File[] | null, source: "picker" | "paste" = "picker") {
    if (!files?.length || !configuration.supportsAttachments) return;
    const incoming = Array.from(files);
    const available = Math.max(0, 3 - attachments.length);
    if (available === 0) {
      if (source === "paste") showToast("最多保留 3 个附件，请先移除一个。", "error");
      return;
    }
    setPreparingAttachment(true);
    try {
      const prepared = await Promise.all(incoming.slice(0, available).map((file) => prepareAiAssistantAttachment(file, {
        accessCode,
        feature: "mind_map",
        onProgress: (completed, total) => setAttachmentProgress(`上传 PDF ${completed}/${total} 页`)
      })));
      setAttachments((current) => [...current, ...prepared].slice(0, 3));
      if (source === "paste" && prepared.length) showToast(`已粘贴 ${prepared.length} 个附件。`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "读取附件失败。", "error");
    } finally {
      setPreparingAttachment(false);
      setAttachmentProgress("");
    }
  }

  function pasteAttachments(event: ReactClipboardEvent<HTMLElement>) {
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length || !configuration.supportsAttachments) return;
    event.preventDefault();
    if (loading || preparingAttachment) {
      showToast("当前正在处理内容，请稍后再粘贴附件。", "error");
      return;
    }
    void addAttachments(files, "paste");
  }

  async function generate() {
    const question = prompt.trim() || (attachments.length ? "请根据附件内容生成一份结构清晰的思维导图。" : "");
    if (!question || loading) return;
    let taskAttachments = attachments;
    setAttachmentProgress(attachments.some((attachment) => attachment.remotePages?.length || attachment.pendingTextBatches?.length) ? "准备分批读取文档" : "");
    const started = startAiTask({
      feature: "mind_map",
      label: "正在生成思维导图",
      successMessage: "思维导图已生成，点击可查看结果。",
      run: (signal) => askAiMindMap({
          prompt: question,
          context: mindMapNeedsScheduleContext(question) ? buildDeepSeekScheduleContext(input, question) : undefined,
          accessCode,
          attachments: taskAttachments,
          depth,
          signal,
          onAttachmentProgress: (completed, total) => {
            if (total > 0) setAttachmentProgress(completed < total ? `正在读取文档 ${completed}/${total} 页` : "文档读取完成，正在生成脑图");
          },
          onAttachmentsProcessed: (nextAttachments) => {
            taskAttachments = nextAttachments;
            setAttachments(nextAttachments);
          }
        }),
      onSuccess: (result) => {
        setAttachmentProgress("");
        localStorage.setItem(mindMapStorageKey(ownerId), JSON.stringify(result.mindMap));
        setMindMap(result.mindMap);
        setFollowupTurns([]);
        setFollowupError("");
        if (result.processedAttachments?.length) {
          setAttachments((current) => replaceProcessedAttachments(current, result.processedAttachments ?? []));
        }
        setZoom(1);
        if (result.access === "access-code") setAccessCode("");
      },
      onError: () => setAttachmentProgress("")
    });
    if (!started) showToast("已有思维导图正在生成。", "error");
  }

  async function submitFollowup() {
    const question = followupQuestion.trim();
    if (!question || !mindMap || followupLoading) return;
    const history: AiMindMapFollowupMessage[] = followupTurns.flatMap((turn) => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer }
    ]);
    const controller = new AbortController();
    followupControllerRef.current = controller;
    setFollowupLoading(true);
    setFollowupError("");
    try {
      const result = await askAiMindMapFollowup({
        question,
        mindMap,
        accessCode,
        attachments,
        history,
        signal: controller.signal
      });
      setFollowupTurns((current) => [...current, { question, answer: result.answer }]);
      setFollowupQuestion("");
      if (result.processedAttachments?.length) {
        setAttachments((current) => replaceProcessedAttachments(current, result.processedAttachments ?? []));
      }
      if (result.access === "access-code") setAccessCode("");
    } catch (error) {
      if (!controller.signal.aborted) setFollowupError(error instanceof Error ? error.message : "追问失败，请稍后重试。");
    } finally {
      if (followupControllerRef.current === controller) followupControllerRef.current = null;
      setFollowupLoading(false);
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
      <div className="mind-map-dialog" onPaste={pasteAttachments}>
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
                  <button type="button" className="icon-button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => {
                    const removed = current[index];
                    if (removed) void releaseAiAssistantAttachments([removed]);
                    return current.filter((_, itemIndex) => itemIndex !== index);
                  })}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          {configuration.supportsAttachments && <p className="attachment-paste-hint">电脑端可按 Ctrl+V 粘贴截图或文件</p>}
          <div className="mind-map-composer-actions">
            <label className="mind-map-depth-control">思考程度
              <select value={depth} onChange={(event) => setDepth(event.target.value as MindMapDepth)}>
                <option value="quick">快速</option>
                <option value="standard">标准</option>
                <option value="deep">深入</option>
              </select>
            </label>
            {configuration.supportsAttachments && (
              <AttachmentSourcePicker
                imageAccept={AI_IMAGE_ACCEPT}
                documentAccept={AI_DOCUMENT_ACCEPT}
                label={preparingAttachment ? attachmentProgress || "读取中" : `附件 ${attachments.length}/3`}
                ariaLabel="选择脑图附件来源"
                disabled={loading || preparingAttachment || attachments.length >= 3}
                onFiles={addAttachments}
              />
            )}
            {loading ? (
              <button type="button" className="button danger-button" onClick={() => { if (cancelAiTask("mind_map")) showToast("已取消思维导图生成。", "success"); }}>
                <X size={16} />取消生成
              </button>
            ) : (
              <button type="button" className="button primary" disabled={!prompt.trim() && attachments.length === 0} onClick={() => void generate()}>
                <Sparkles size={16} />生成脑图
              </button>
            )}
          </div>
          {loading && attachmentProgress && <p className="mind-map-processing-status" role="status">{attachmentProgress}</p>}
          {task.status === "error" && (
            <div className="ai-inline-error" role="alert">
              <span>{task.message}</span>
              <button type="button" className="button secondary compact" onClick={() => retryAiTask("mind_map")}>重试</button>
            </div>
          )}
        </section>

        <section className="mind-map-result" aria-label="思维导图结果">
          {mindMap ? (
            <>
              <div className="mind-map-result-toolbar">
                <div><Network size={18} /><span><strong>{mindMap.label}</strong><small>可拖动滚动区域查看完整结构</small></span></div>
                <div>
                  <button type="button" className="icon-button" aria-label="缩小脑图" onClick={() => setZoom((current) => Math.max(0, Number((current - 0.1).toFixed(1))))}><Minus size={16} /></button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" className="icon-button" aria-label="放大脑图" onClick={() => setZoom((current) => Math.min(1.5, current + 0.1))}><Plus size={16} /></button>
                  <button type="button" className="icon-button" aria-label="预览" title="预览完整脑图" onClick={() => setPreviewing(true)}><Eye size={16} /></button>
                  <button type="button" className="button secondary compact" onClick={() => downloadMindMapSvg(mindMap)}><Download size={15} />SVG</button>
                  <button type="button" className="button secondary compact" onClick={() => void downloadMindMapPng(mindMap)}><Download size={15} />PNG</button>
                </div>
              </div>
              <MindMapCanvas root={mindMap} zoom={zoom} onPreview={() => setPreviewing(true)} />
              <div className="mind-map-followup">
                {followupTurns.length > 0 && (
                  <div className="mind-map-followup-history" aria-live="polite">
                    {followupTurns.map((turn, index) => (
                      <div key={`${turn.question}-${index}`}>
                        <strong>{turn.question}</strong>
                        <p>{turn.answer}</p>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={(event) => { event.preventDefault(); void submitFollowup(); }}>
                  <input
                    value={followupQuestion}
                    maxLength={1000}
                    aria-label="追问思维导图"
                    placeholder="继续追问附件或脑图中的内容"
                    onChange={(event) => setFollowupQuestion(event.target.value)}
                  />
                  {followupLoading ? (
                    <button type="button" className="icon-button danger-button" aria-label="取消追问" onClick={() => followupControllerRef.current?.abort()}><X size={17} /></button>
                  ) : (
                    <button type="submit" className="icon-button primary" aria-label="发送追问" disabled={!followupQuestion.trim()}><Send size={17} /></button>
                  )}
                </form>
                {followupError && <div className="ai-inline-error" role="alert"><span>{followupError}</span></div>}
              </div>
            </>
          ) : (
            <div className="mind-map-empty"><Network size={42} /><strong>输入主题后生成思维导图</strong><span>AI 会提炼中心主题、主要分支和关键节点。</span></div>
          )}
        </section>
      </div>
      {previewing && mindMap && (
        <div className="mind-map-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewing(false)}>
          <section className="mind-map-preview-dialog" role="dialog" aria-modal="true" aria-label="思维导图预览">
            <header><strong>{mindMap.label}</strong><button type="button" className="icon-button" aria-label="关闭预览" onClick={() => setPreviewing(false)}><X size={20} /></button></header>
            <div><img src={mindMapPreviewUrl(mindMap)} alt={`${mindMap.label} 完整预览`} /></div>
            <footer><button type="button" className="button secondary" onClick={() => downloadMindMapSvg(mindMap)}><Download size={15} />SVG</button><button type="button" className="button primary" onClick={() => void downloadMindMapPng(mindMap)}><Download size={15} />PNG</button></footer>
          </section>
        </div>
      )}
    </Modal>
  );
}

export function MindMapCanvas({ root, zoom, onPreview }: { root: AiMindMapNode; zoom: number; onPreview?: () => void }) {
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
    <div ref={viewportRef} className="mind-map-viewport" onDoubleClick={onPreview} title={onPreview ? "双击预览完整脑图" : undefined}>
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

function replaceProcessedAttachments(current: AiAssistantAttachment[], processed: AiAssistantAttachment[]): AiAssistantAttachment[] {
  const replacements = new Map(processed.map((attachment) => [`${attachment.kind}:${attachment.name}`, attachment]));
  return current.map((attachment) => replacements.get(`${attachment.kind}:${attachment.name}`) ?? attachment);
}

function loadMindMap(ownerId: string): AiMindMapNode | null {
  try {
    const saved = JSON.parse(localStorage.getItem(mindMapStorageKey(ownerId)) ?? "null") as AiMindMapNode | null;
    return saved?.label ? saved : null;
  } catch {
    return null;
  }
}

function mindMapPreviewUrl(root: AiMindMapNode): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mindMapToSvg(root))}`;
}
