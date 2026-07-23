import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, GripHorizontal, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { dismissAiTask, getAiTaskSnapshots, openAiTask, retryAiTask, subscribeAiTasks } from "../lib/aiBackgroundTasks";

const EMPTY_TASKS: ReturnType<typeof getAiTaskSnapshots> = [];
const POSITION_KEY = "semester-schedule-ai-task-center-position";

interface StoredPosition {
  x: number | null;
  y: number | null;
  collapsed: boolean;
}

export function AiTaskCenter() {
  const tasks = useSyncExternalStore(subscribeAiTasks, getAiTaskSnapshots, () => EMPTY_TASKS);
  const [position, setPosition] = useState<StoredPosition>(() => loadPosition());
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const keepVisible = () => {
      const panel = panelRef.current;
      if (!panel || position.x == null || position.y == null) return;
      const rect = panel.getBoundingClientRect();
      const next = clampPosition(position.x, position.y, rect.width, rect.height);
      if (next.x !== position.x || next.y !== position.y) updatePosition({ ...position, ...next });
    };
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, [position.x, position.y, position.collapsed, tasks.length]);

  if (!tasks.length) return null;

  function updatePosition(next: StoredPosition) {
    setPosition(next);
    localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const next = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY, rect.width, rect.height);
    updatePosition({ ...position, ...next });
  }

  function stopDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const style = position.x == null || position.y == null
    ? undefined
    : { left: position.x, top: position.y, right: "auto", bottom: "auto" };

  if (position.collapsed) {
    const running = tasks.filter((task) => task.status === "running").length;
    return (
      <aside ref={panelRef} style={style} className="ai-task-center collapsed" aria-label="AI 后台任务">
        <div
          className="ai-task-collapsed-handle"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          {running ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
          <strong>AI {tasks.length}</strong>
          <button type="button" className="icon-button" title="展开后台任务" aria-label="展开AI后台任务" onPointerDown={(event) => event.stopPropagation()} onClick={() => updatePosition({ ...position, collapsed: false })}><ChevronUp size={15} /></button>
        </div>
      </aside>
    );
  }

  return (
    <aside ref={panelRef} style={style} className="ai-task-center" aria-label="AI 后台任务">
      <header
        className="ai-task-drag-handle"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <GripHorizontal size={16} />
        <span>AI 后台任务</span>
        <button type="button" className="icon-button" title="折叠后台任务" aria-label="折叠AI后台任务" onPointerDown={(event) => event.stopPropagation()} onClick={() => updatePosition({ ...position, collapsed: true })}><ChevronDown size={15} /></button>
      </header>
      {tasks.map((task) => (
        <section key={task.feature} className={`ai-task-notice ${task.status}`} role="status">
          {task.status === "running" ? <LoaderCircle className="spin" size={18} /> : task.status === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <div><strong>{task.label}</strong><span>{task.message}</span></div>
          {task.status === "error" && <button type="button" className="icon-button" title="重试" aria-label={`重试${task.label}`} onClick={() => retryAiTask(task.feature)}><RotateCcw size={15} /></button>}
          {task.status !== "running" && <button type="button" className="button secondary compact" onClick={() => openAiTask(task.feature)}>查看</button>}
          {task.status !== "running" && <button type="button" className="icon-button" title="关闭" aria-label={`关闭${task.label}通知`} onClick={() => dismissAiTask(task.feature)}><X size={15} /></button>}
        </section>
      ))}
    </aside>
  );
}

function loadPosition(): StoredPosition {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as Partial<StoredPosition> | null;
    return {
      x: typeof value?.x === "number" ? value.x : null,
      y: typeof value?.y === "number" ? value.y : null,
      collapsed: Boolean(value?.collapsed)
    };
  } catch {
    return { x: null, y: null, collapsed: false };
  }
}

function clampPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const margin = 8;
  const bottomReserved = window.matchMedia("(max-width: 900px)").matches ? 88 : margin;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - bottomReserved))
  };
}
