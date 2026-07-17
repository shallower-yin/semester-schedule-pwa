import { AlertCircle, CheckCircle2, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { dismissAiTask, getAiTaskSnapshots, openAiTask, retryAiTask, subscribeAiTasks } from "../lib/aiBackgroundTasks";

const EMPTY_TASKS: ReturnType<typeof getAiTaskSnapshots> = [];

export function AiTaskCenter() {
  const tasks = useSyncExternalStore(subscribeAiTasks, getAiTaskSnapshots, () => EMPTY_TASKS);
  if (!tasks.length) return null;
  return (
    <aside className="ai-task-center" aria-label="AI 后台任务">
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
