import { ChevronLeft, ChevronRight, Image as ImageIcon, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMemoImageUrls } from "../lib/memoImages";
import type { MemoImage } from "../types";
import { Modal } from "./Modal";

interface MemoImagePreviewProps {
  images: MemoImage[];
  initialIndex: number;
  onClose: () => void;
}

type LoadPhase = "signing" | "image" | "ready" | "error";
type Point = { x: number; y: number };
type Gesture =
  | { kind: "pan"; pointerId: number; start: Point; startPan: Point }
  | { kind: "pinch"; startCenter: Point; startDistance: number; startPan: Point; startZoom: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export function MemoImagePreview({ images, initialIndex, onClose }: MemoImagePreviewProps) {
  const safeInitialIndex = Math.min(Math.max(0, initialIndex), Math.max(0, images.length - 1));
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex);
  const [imageUrl, setImageUrl] = useState("");
  const [phase, setPhase] = useState<LoadPhase>("signing");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture | null>(null);
  const activeImage = images[activeIndex];

  zoomRef.current = zoom;
  panRef.current = pan;

  const resetTransform = useCallback(() => {
    zoomRef.current = MIN_ZOOM;
    panRef.current = { x: 0, y: 0 };
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    pointersRef.current.clear();
    gestureRef.current = null;
  }, []);

  const selectImage = useCallback((nextIndex: number) => {
    if (!images.length) return;
    const wrappedIndex = (nextIndex + images.length) % images.length;
    setImageUrl("");
    setErrorMessage("");
    setPhase("signing");
    resetTransform();
    setActiveIndex(wrappedIndex);
  }, [images.length, resetTransform]);

  const retry = useCallback(() => {
    setImageUrl("");
    setErrorMessage("");
    setPhase("signing");
    resetTransform();
    setLoadAttempt((current) => current + 1);
  }, [resetTransform]);

  useEffect(() => {
    if (!activeImage) return;
    let current = true;
    setImageUrl("");
    setErrorMessage("");
    setPhase("signing");
    void getMemoImageUrls([activeImage])
      .then((urls) => {
        if (!current) return;
        const freshUrl = urls[activeImage.path];
        if (!freshUrl) throw new Error("暂时无法取得这张图片的访问地址。");
        setImageUrl(freshUrl);
        setPhase("image");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setErrorMessage(error instanceof Error ? error.message : "图片加载失败，请重试。");
        setPhase("error");
      });
    return () => {
      current = false;
    };
  }, [activeImage, loadAttempt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (images.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      selectImage(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, images.length, selectImage]);

  if (!activeImage) return null;

  function clampZoom(nextZoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom * 100) / 100));
  }

  function clampPan(nextPan: Point, atZoom: number): Point {
    if (atZoom <= MIN_ZOOM) return { x: 0, y: 0 };
    const viewport = viewportRef.current;
    if (!viewport) return nextPan;
    const image = imageRef.current;
    const renderedWidth = image?.clientWidth || viewport.clientWidth;
    const renderedHeight = image?.clientHeight || viewport.clientHeight;
    const maxX = Math.max(0, (renderedWidth * atZoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (renderedHeight * atZoom - viewport.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPan.y))
    };
  }

  function updateTransform(nextZoom: number, nextPan = panRef.current) {
    const boundedZoom = clampZoom(nextZoom);
    const boundedPan = clampPan(nextPan, boundedZoom);
    zoomRef.current = boundedZoom;
    panRef.current = boundedPan;
    setZoom(boundedZoom);
    setPan(boundedPan);
  }

  function changeZoom(delta: number) {
    updateTransform(zoomRef.current + delta);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (phase !== "ready") return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "ready") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "pan") {
      const point = pointersRef.current.get(gesture.pointerId);
      if (!point || zoomRef.current <= MIN_ZOOM) return;
      updateTransform(zoomRef.current, {
        x: gesture.startPan.x + point.x - gesture.start.x,
        y: gesture.startPan.y + point.y - gesture.start.y
      });
      return;
    }
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return;
    const distance = pointDistance(points[0], points[1]);
    const center = pointCenter(points[0], points[1]);
    const nextZoom = gesture.startZoom * distance / Math.max(1, gesture.startDistance);
    updateTransform(nextZoom, {
      x: gesture.startPan.x + center.x - gesture.startCenter.x,
      y: gesture.startPan.y + center.y - gesture.startCenter.y
    });
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    beginGesture();
  }

  function beginGesture() {
    const entries = [...pointersRef.current.entries()];
    if (entries.length >= 2) {
      const first = entries[0][1];
      const second = entries[1][1];
      gestureRef.current = {
        kind: "pinch",
        startCenter: pointCenter(first, second),
        startDistance: pointDistance(first, second),
        startPan: panRef.current,
        startZoom: zoomRef.current
      };
    } else if (entries.length === 1) {
      gestureRef.current = {
        kind: "pan",
        pointerId: entries[0][0],
        start: entries[0][1],
        startPan: panRef.current
      };
    } else {
      gestureRef.current = null;
    }
  }

  return (
    <Modal
      title={`查看图片：${activeImage.name}`}
      onClose={onClose}
      wide
      className="memo-image-preview-modal"
      headerExtra={<span className="memo-image-preview-count">{activeIndex + 1} / {images.length}</span>}
    >
      <div className="memo-image-preview-content">
        <div
          ref={viewportRef}
          className={`memo-image-preview-viewport ${zoom > MIN_ZOOM ? "zoomed" : ""}`}
          role="region"
          aria-label={`图片预览 ${activeImage.name}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {imageUrl && phase !== "error" && (
            <img
              ref={imageRef}
              src={imageUrl}
              alt={activeImage.name}
              draggable={false}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
              onLoad={() => setPhase("ready")}
              onError={() => {
                setErrorMessage("图片内容加载失败，请检查网络后重试。");
                setPhase("error");
              }}
            />
          )}
          {(phase === "signing" || phase === "image") && (
            <div className="memo-image-preview-status" role="status">
              <ImageIcon size={32} />
              <span>正在加载原图…</span>
            </div>
          )}
          {phase === "error" && (
            <div className="memo-image-preview-status error" role="alert">
              <ImageIcon size={32} />
              <span>{errorMessage || "图片加载失败，请重试。"}</span>
              <button type="button" className="button secondary compact" onClick={retry}>重新加载</button>
            </div>
          )}
        </div>
        <footer className="memo-image-preview-toolbar">
          <div className="memo-image-preview-navigation">
            <button
              type="button"
              className="icon-button"
              aria-label="上一张图片"
              disabled={images.length < 2}
              onClick={() => selectImage(activeIndex - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <span className="memo-image-preview-name" title={activeImage.name}>{activeImage.name}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="下一张图片"
              disabled={images.length < 2}
              onClick={() => selectImage(activeIndex + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="memo-image-preview-zoom" aria-label="缩放控制">
            <button type="button" className="icon-button" aria-label="缩小图片" disabled={phase !== "ready" || zoom <= MIN_ZOOM} onClick={() => changeZoom(-ZOOM_STEP)}><Minus size={18} /></button>
            <button type="button" className="memo-image-preview-zoom-value" aria-label="重置图片缩放" disabled={phase !== "ready" || (zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0)} onClick={resetTransform}>
              <RotateCcw size={15} />{Math.round(zoom * 100)}%
            </button>
            <button type="button" className="icon-button" aria-label="放大图片" disabled={phase !== "ready" || zoom >= MAX_ZOOM} onClick={() => changeZoom(ZOOM_STEP)}><Plus size={18} /></button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

function pointDistance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointCenter(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
