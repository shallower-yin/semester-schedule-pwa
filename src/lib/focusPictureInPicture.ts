import { elapsedFocusSeconds, focusModeLabel, formatFocusDuration, remainingFocusSeconds, type ActiveFocusState } from "./focus";

let canvas: HTMLCanvasElement | null = null;
let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;

export function focusPictureInPictureSupported(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("video");
  const canvasProbe = document.createElement("canvas");
  return document.pictureInPictureEnabled !== false
    && typeof probe.requestPictureInPicture === "function"
    && typeof canvasProbe.captureStream === "function";
}

export async function openFocusPictureInPicture(active: ActiveFocusState, now = new Date()): Promise<void> {
  if (!focusPictureInPictureSupported()) throw new Error("当前浏览器不支持系统画中画，请使用最新版 Chrome 或 Edge。");
  ensurePictureInPictureMedia();
  updateFocusPictureInPicture(active, now);
  await video!.play();
  if (document.pictureInPictureElement !== video) await video!.requestPictureInPicture();
}

export function updateFocusPictureInPicture(active: ActiveFocusState | null, now = new Date()): void {
  if (!canvas || !active) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const remaining = remainingFocusSeconds(active, now);
  const elapsed = elapsedFocusSeconds(active, now);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#101827";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#2d5de0";
  context.fillRect(0, 0, 12, canvas.height);
  context.fillStyle = "#9fb7f8";
  context.font = "600 22px system-ui, sans-serif";
  context.fillText(active.pause_started_at ? "已暂停" : focusModeLabel(active.mode), 38, 48);
  context.fillStyle = "#ffffff";
  context.font = "700 58px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.fillText(formatFocusDuration(remaining ?? elapsed), 36, 128);
  context.fillStyle = "#dbe5ff";
  context.font = "600 25px system-ui, sans-serif";
  drawEllipsizedText(context, active.task_title, 36, 180, canvas.width - 72);
  context.fillStyle = "#8796b3";
  context.font = "18px system-ui, sans-serif";
  context.fillText("专注倒计时", 36, 224);
}

export async function closeFocusPictureInPicture(): Promise<void> {
  if (typeof document !== "undefined" && document.pictureInPictureElement === video) {
    await document.exitPictureInPicture().catch(() => undefined);
  }
}

function ensurePictureInPictureMedia() {
  if (canvas && video && stream) return;
  canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 270;
  stream = canvas.captureStream(1);
  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
}

function drawEllipsizedText(context: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }
  let text = value;
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  context.fillText(`${text}…`, x, y);
}
