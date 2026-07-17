export type AiTaskFeature = "assistant" | "mind_map" | "audio_transcription";
export type AiTaskStatus = "idle" | "running" | "success" | "error";

export interface AiTaskSnapshot {
  feature: AiTaskFeature;
  status: AiTaskStatus;
  label: string;
  message: string;
  startedAt: number | null;
  completedAt: number | null;
}

interface AiTaskDefinition<T> {
  feature: AiTaskFeature;
  label: string;
  successMessage?: string;
  run: () => Promise<T>;
  onSuccess?: (result: T) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export const AI_TASK_OPEN_EVENT = "semester-schedule-open-ai-task";

const FEATURE_LABELS: Record<AiTaskFeature, string> = {
  assistant: "AI 助手",
  mind_map: "AI 思维导图",
  audio_transcription: "AI 音频转写"
};

const idleSnapshots: Record<AiTaskFeature, AiTaskSnapshot> = {
  assistant: idleSnapshot("assistant"),
  mind_map: idleSnapshot("mind_map"),
  audio_transcription: idleSnapshot("audio_transcription")
};

const tasks = new Map<AiTaskFeature, AiTaskSnapshot>();
const retries = new Map<AiTaskFeature, () => void>();
const listeners = new Set<() => void>();
const openDialogs = new Set<AiTaskFeature>();
const dismissalTimers = new Map<AiTaskFeature, number>();
let taskListSnapshot: AiTaskSnapshot[] = [];

export function subscribeAiTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiTaskSnapshot(feature: AiTaskFeature): AiTaskSnapshot {
  return tasks.get(feature) ?? idleSnapshots[feature];
}

export function getAiTaskSnapshots(): AiTaskSnapshot[] {
  return taskListSnapshot;
}

export function setAiTaskDialogOpen(feature: AiTaskFeature, open: boolean): void {
  if (open) openDialogs.add(feature);
  else openDialogs.delete(feature);
  emit();
}

export function startAiTask<T>(definition: AiTaskDefinition<T>): boolean {
  if (getAiTaskSnapshot(definition.feature).status === "running") return false;
  clearDismissalTimer(definition.feature);
  const startedAt = Date.now();
  retries.set(definition.feature, () => startAiTask(definition));
  updateTask({
    feature: definition.feature,
    status: "running",
    label: definition.label,
    message: "可以继续使用其他页面，完成后会通知你。",
    startedAt,
    completedAt: null
  });

  void Promise.resolve()
    .then(definition.run)
    .then(async (result) => {
      await definition.onSuccess?.(result);
      const message = definition.successMessage ?? `${FEATURE_LABELS[definition.feature]}已完成。`;
      updateTask({
        feature: definition.feature,
        status: "success",
        label: FEATURE_LABELS[definition.feature],
        message,
        startedAt,
        completedAt: Date.now()
      });
      scheduleSuccessDismissal(definition.feature);
      if (!openDialogs.has(definition.feature)) void showCompletionNotification(definition.feature, message);
    })
    .catch(async (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause || "AI 任务失败。"));
      await definition.onError?.(error);
      updateTask({
        feature: definition.feature,
        status: "error",
        label: FEATURE_LABELS[definition.feature],
        message: error.message,
        startedAt,
        completedAt: Date.now()
      });
      if (!openDialogs.has(definition.feature)) void showCompletionNotification(definition.feature, `${FEATURE_LABELS[definition.feature]}失败：${error.message}`);
    });
  return true;
}

export function retryAiTask(feature: AiTaskFeature): void {
  retries.get(feature)?.();
}

export function dismissAiTask(feature: AiTaskFeature): void {
  if (getAiTaskSnapshot(feature).status === "running") return;
  clearDismissalTimer(feature);
  tasks.delete(feature);
  retries.delete(feature);
  emit();
}

function scheduleSuccessDismissal(feature: AiTaskFeature): void {
  clearDismissalTimer(feature);
  const timer = window.setTimeout(() => {
    dismissalTimers.delete(feature);
    if (getAiTaskSnapshot(feature).status === "success") dismissAiTask(feature);
  }, 3000);
  dismissalTimers.set(feature, timer);
}

function clearDismissalTimer(feature: AiTaskFeature): void {
  const timer = dismissalTimers.get(feature);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissalTimers.delete(feature);
}

export function openAiTask(feature: AiTaskFeature): void {
  window.dispatchEvent(new CustomEvent(AI_TASK_OPEN_EVENT, { detail: { feature } }));
}

function idleSnapshot(feature: AiTaskFeature): AiTaskSnapshot {
  return {
    feature,
    status: "idle",
    label: FEATURE_LABELS[feature],
    message: "",
    startedAt: null,
    completedAt: null
  };
}

function updateTask(task: AiTaskSnapshot): void {
  tasks.set(task.feature, task);
  emit();
}

function emit(): void {
  taskListSnapshot = (["assistant", "mind_map", "audio_transcription"] as const)
    .map((feature) => getAiTaskSnapshot(feature))
    .filter((task) => task.status !== "idle" && !openDialogs.has(task.feature));
  listeners.forEach((listener) => listener());
}

async function showCompletionNotification(feature: AiTaskFeature, body: string): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const target = new URL(window.location.href);
  target.searchParams.set("ai", feature);
  await registration.showNotification(FEATURE_LABELS[feature], {
    body,
    tag: `ai-task-${feature}`,
    icon: `${import.meta.env.BASE_URL}app-icon-192.png`,
    badge: `${import.meta.env.BASE_URL}app-icon-192.png`,
    data: { url: target.toString() }
  });
}
