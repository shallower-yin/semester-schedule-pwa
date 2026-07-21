import { Download, Eye, FileText, Image as ImageIcon, KeyRound, Maximize2, Minimize2, Minus, Network, Plus, Send, Sparkles, X } from "lucide-react";
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
  const initialSession = useMemo(() => loadMindMapSession(ownerId), [ownerId]);
  const [prompt, setPrompt] = useState(() => initialSession.prompt);
  const [accessCode, setAccessCode] = useState("");
  const [mindMap, setMindMap] = useState<AiMindMapNode | null>(() => initialSession.mindMap);
  const [attachments, setAttachments] = useState<AiAssistantAttachment[]>(() => initialSession.attachments);
  const [configuration, setConfiguration] = useState<AiAssistantConfiguration>({ provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false });
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [zoom, setZoom] = useState(1);
  const [depth, setDepth] = useState<MindMapDepth>(() => initialSession.depth);
  const [previewing, setPreviewing] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const previewImgRef = useRef<HTMLDivElement>(null);
  const previewZoomRef = useRef(1);
  const previewPanRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; zoom: number; panX: number; panY: number; cx: number; cy: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [followupQuestion, setFollowupQuestion] = useState("");
  const [followupTurns, setFollowupTurns] = useState<MindMapFollowupTurn[]>(() => initialSession.followupTurns);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState("");
  const followupControllerRef = useRef<AbortController | null>(null);
  const task = useSyncExternalStore(subscribeAiTasks, () => getAiTaskSnapshot("mind_map"), () => getAiTaskSnapshot("mind_map"));
  const loading = task.status === "running";
  useEffect(() => {
    void getAiAssistantConfiguration().then(setConfiguration);
  }, []);

  useEffect(() => {
    const session = loadMindMapSession(ownerId);
    setMindMap(session.mindMap);
    setFollowupTurns(session.followupTurns);
    setPrompt(session.prompt);
    setDepth(session.depth);
    setAttachments(session.attachments);
    setFollowupError("");
  }, [ownerId]);

  useEffect(() => {
    saveMindMapSession(ownerId, {
      mindMap,
      followupTurns,
      prompt,
      depth,
      attachments
    });
  }, [ownerId, mindMap, followupTurns, prompt, depth, attachments]);

  useEffect(() => {
    if (!previewing) return;
    previewZoomRef.current = 1;
    previewPanRef.current = { x: 0, y: 0 };
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }, [previewing]);

  useEffect(() => {
    previewZoomRef.current = previewZoom;
  }, [previewZoom]);

  useEffect(() => {
    previewPanRef.current = previewPan;
  }, [previewPan]);

  // Android WebView needs non-passive touch/wheel listeners so preventDefault can stop page scroll
  // during pinch-zoom and one-finger pan. React's synthetic onTouchMove is often passive.
  useEffect(() => {
    if (!previewing) return;
    const el = previewImgRef.current;
    if (!el) return;

    const clampZoom = (value: number) => Math.min(5, Math.max(0.2, value));

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const next = clampZoom(previewZoomRef.current + (-event.deltaY * 0.002));
      previewZoomRef.current = next;
      setPreviewZoom(next);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        dragRef.current = null;
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        pinchRef.current = {
          dist: Math.max(1, Math.hypot(dx, dy)),
          zoom: previewZoomRef.current,
          panX: previewPanRef.current.x,
          panY: previewPanRef.current.y,
          cx: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          cy: (event.touches[0].clientY + event.touches[1].clientY) / 2
        };
        return;
      }
      if (event.touches.length === 1) {
        pinchRef.current = null;
        dragRef.current = {
          startX: event.touches[0].clientX,
          startY: event.touches[0].clientY,
          panX: previewPanRef.current.x,
          panY: previewPanRef.current.y
        };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2 && pinchRef.current) {
        event.preventDefault();
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const scale = dist / pinchRef.current.dist;
        const nextZoom = clampZoom(pinchRef.current.zoom * scale);
        const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        // Keep the content under the pinch midpoint stable while zooming.
        const nextPan = {
          x: pinchRef.current.panX + (cx - pinchRef.current.cx),
          y: pinchRef.current.panY + (cy - pinchRef.current.cy)
        };
        previewZoomRef.current = nextZoom;
        previewPanRef.current = nextPan;
        setPreviewZoom(nextZoom);
        setPreviewPan(nextPan);
        return;
      }
      if (event.touches.length === 1 && dragRef.current) {
        event.preventDefault();
        const nextPan = {
          x: dragRef.current.panX + (event.touches[0].clientX - dragRef.current.startX),
          y: dragRef.current.panY + (event.touches[0].clientY - dragRef.current.startY)
        };
        previewPanRef.current = nextPan;
        setPreviewPan(nextPan);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      if (event.touches.length === 1) {
        pinchRef.current = null;
        dragRef.current = {
          startX: event.touches[0].clientX,
          startY: event.touches[0].clientY,
          panX: previewPanRef.current.x,
          panY: previewPanRef.current.y
        };
        return;
      }
      pinchRef.current = null;
      dragRef.current = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [previewing]);

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
        // New mind map starts a new topic: keep attachments/prompt, reset follow-up thread.
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
              onFocus={(event) => {
                // Keep the action row (attachments / generate) above the soft keyboard on APK/WebView.
                const target = event.currentTarget;
                window.setTimeout(() => {
                  target.scrollIntoView({ block: "center", behavior: "smooth" });
                  document.querySelector(".mind-map-composer-actions")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }, 80);
              }}
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
                <div><Network size={18} /><span><strong>{mindMap.label}</strong><small>可拖动查看 · 可追问并补充背景</small></span></div>
                <div className="mind-map-result-toolbar-actions" role="toolbar" aria-label="脑图操作">
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
                    placeholder="继续追问，可补充背景后让 AI 一起分析"
                    onChange={(event) => setFollowupQuestion(event.target.value)}
                    onFocus={(event) => {
                      const target = event.currentTarget;
                      window.setTimeout(() => {
                        target.scrollIntoView({ block: "center", behavior: "smooth" });
                        document.querySelector(".mind-map-followup")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                      }, 80);
                    }}
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
        <div className={`mind-map-preview-backdrop ${previewFullscreen ? "fullscreen" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewing(false)}>
          <section className="mind-map-preview-dialog" role="dialog" aria-modal="true" aria-label="思维导图预览">
            <header>
              <strong>{mindMap.label}</strong>
              <div>
                <button type="button" className="icon-button" aria-label={previewFullscreen ? "退出全屏" : "全屏预览"} title={previewFullscreen ? "退出全屏" : "全屏预览"} onClick={() => setPreviewFullscreen((f) => !f)}>
                  {previewFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-button mind-map-preview-close"
                  aria-label="关闭预览"
                  title="关闭预览"
                  onClick={() => { setPreviewing(false); setPreviewFullscreen(false); }}
                >
                  <X size={22} />
                </button>
              </div>
            </header>
            <div
              className="mind-map-preview-image-container"
              ref={previewImgRef}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                dragRef.current = { startX: event.clientX, startY: event.clientY, panX: previewPanRef.current.x, panY: previewPanRef.current.y };
              }}
              onMouseMove={(event) => {
                if (!dragRef.current) return;
                const nextPan = {
                  x: dragRef.current.panX + (event.clientX - dragRef.current.startX),
                  y: dragRef.current.panY + (event.clientY - dragRef.current.startY)
                };
                previewPanRef.current = nextPan;
                setPreviewPan(nextPan);
              }}
              onMouseUp={() => { dragRef.current = null; }}
              onMouseLeave={() => { dragRef.current = null; }}
              style={{ touchAction: "none", cursor: "grab" }}
            >
              <img
                src={mindMapPreviewUrl(mindMap)}
                alt={`${mindMap.label} 完整预览`}
                style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`, transformOrigin: "center center" }}
                draggable={false}
              />
            </div>
            <footer>
              <button type="button" className="icon-button" aria-label="缩小" onClick={() => {
                const next = Math.max(0.2, previewZoomRef.current - 0.3);
                previewZoomRef.current = next;
                setPreviewZoom(next);
              }}><Minus size={15} /></button>
              <span className="mind-map-preview-zoom-label">{Math.round(previewZoom * 100)}%</span>
              <button type="button" className="icon-button" aria-label="放大" onClick={() => {
                const next = Math.min(5, previewZoomRef.current + 0.3);
                previewZoomRef.current = next;
                setPreviewZoom(next);
              }}><Plus size={15} /></button>
              <button type="button" className="button secondary compact" onClick={() => {
                previewZoomRef.current = 1;
                previewPanRef.current = { x: 0, y: 0 };
                setPreviewZoom(1);
                setPreviewPan({ x: 0, y: 0 });
              }} disabled={previewZoom === 1 && previewPan.x === 0 && previewPan.y === 0}>重置</button>
              <button type="button" className="button secondary compact" onClick={() => downloadMindMapSvg(mindMap)}><Download size={13} />SVG</button>
              <button type="button" className="button primary compact" onClick={() => void downloadMindMapPng(mindMap)}><Download size={13} />PNG</button>
              <button type="button" className="button secondary compact mind-map-preview-close" onClick={() => { setPreviewing(false); setPreviewFullscreen(false); }}>关闭</button>
            </footer>
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

interface MindMapSession {
  mindMap: AiMindMapNode | null;
  followupTurns: MindMapFollowupTurn[];
  prompt: string;
  depth: MindMapDepth;
  attachments: AiAssistantAttachment[];
}

function mindMapStorageKey(ownerId: string): string {
  return `semester-schedule-mind-map:${ownerId}`;
}

function mindMapSessionStorageKey(ownerId: string): string {
  return `semester-schedule-mind-map-session:${ownerId}`;
}

function replaceProcessedAttachments(current: AiAssistantAttachment[], processed: AiAssistantAttachment[]): AiAssistantAttachment[] {
  const replacements = new Map(processed.map((attachment) => [`${attachment.kind}:${attachment.name}`, attachment]));
  return current.map((attachment) => replacements.get(`${attachment.kind}:${attachment.name}`) ?? attachment);
}

/** Persist follow-up context without huge binary page images / data URLs. */
function slimAttachmentsForStorage(attachments: AiAssistantAttachment[]): AiAssistantAttachment[] {
  return attachments.slice(0, 3).map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    text: attachment.text?.slice(0, 40_000),
    documentId: attachment.documentId,
    pageCount: attachment.pageCount,
    processedPageCount: attachment.processedPageCount,
    notice: attachment.notice
  }));
}

function emptyMindMapSession(): MindMapSession {
  return { mindMap: null, followupTurns: [], prompt: "", depth: "standard", attachments: [] };
}

function loadMindMapSession(ownerId: string): MindMapSession {
  try {
    const rawSession = localStorage.getItem(mindMapSessionStorageKey(ownerId));
    if (rawSession) {
      const parsed = JSON.parse(rawSession) as Partial<MindMapSession>;
      const mindMap = parsed.mindMap && typeof parsed.mindMap === "object" && parsed.mindMap.label ? parsed.mindMap : null;
      const followupTurns = Array.isArray(parsed.followupTurns)
        ? parsed.followupTurns
          .filter((turn): turn is MindMapFollowupTurn => Boolean(turn && typeof turn.question === "string" && typeof turn.answer === "string"))
          .slice(-20)
        : [];
      const depth = parsed.depth === "quick" || parsed.depth === "deep" || parsed.depth === "standard" ? parsed.depth : "standard";
      const attachments = Array.isArray(parsed.attachments)
        ? parsed.attachments.filter((item): item is AiAssistantAttachment => Boolean(item && item.name && item.kind)).slice(0, 3)
        : [];
      return {
        mindMap,
        followupTurns,
        prompt: typeof parsed.prompt === "string" ? parsed.prompt.slice(0, 6000) : "",
        depth,
        attachments
      };
    }
    // Backward compatible: older builds only stored the mind-map tree.
    const legacy = JSON.parse(localStorage.getItem(mindMapStorageKey(ownerId)) ?? "null") as AiMindMapNode | null;
    if (legacy?.label) return { ...emptyMindMapSession(), mindMap: legacy };
  } catch {
    // Fall through to empty session.
  }
  return emptyMindMapSession();
}

function saveMindMapSession(ownerId: string, session: MindMapSession): void {
  try {
    const payload: MindMapSession = {
      mindMap: session.mindMap,
      followupTurns: session.followupTurns.slice(-20),
      prompt: session.prompt.slice(0, 6000),
      depth: session.depth,
      attachments: slimAttachmentsForStorage(session.attachments)
    };
    localStorage.setItem(mindMapSessionStorageKey(ownerId), JSON.stringify(payload));
    if (session.mindMap?.label) localStorage.setItem(mindMapStorageKey(ownerId), JSON.stringify(session.mindMap));
    else localStorage.removeItem(mindMapStorageKey(ownerId));
  } catch {
    // Quota or private mode — ignore persistence failures.
  }
}

function mindMapPreviewUrl(root: AiMindMapNode): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mindMapToSvg(root))}`;
}
