import { useCallback, useEffect, useRef } from "react";
import { appHistoryLayer, isAppHistoryUnwinding, isCurrentAppHistoryLayer, markAppHistoryUnwind, pushAppHistoryLayer } from "./appHistory";

// popstate contains the destination, not the layer that was popped. Keep the
// mounted push order so covered layers do not mistake a sibling's back for theirs.
const activeLayers = new Set<string>();

export function useHistoryLayer(open: boolean, onBack: () => void, prefix = "layer"): () => void {
  const layerIdRef = useRef(`${prefix}-${crypto.randomUUID()}`);
  const onBackRef = useRef(onBack);
  const pushedRef = useRef(false);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!open) return;
    const layerId = layerIdRef.current;
    const timer = window.setTimeout(() => {
      pushAppHistoryLayer(layerId);
      activeLayers.add(layerId);
      pushedRef.current = true;
    }, 0);

    const handlePopState = (event: PopStateEvent) => {
      if (isAppHistoryUnwinding()) return;
      if ([...activeLayers].at(-1) !== layerId) return;
      if (!pushedRef.current || appHistoryLayer(event.state) === layerId) return;
      pushedRef.current = false;
      activeLayers.delete(layerId);
      onBackRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", handlePopState);
      activeLayers.delete(layerId);
      if (pushedRef.current && isCurrentAppHistoryLayer(layerId)) {
        pushedRef.current = false;
        markAppHistoryUnwind();
        window.history.back();
      }
    };
  }, [open]);

  return useCallback(() => {
    if (pushedRef.current && isCurrentAppHistoryLayer(layerIdRef.current)) {
      pushedRef.current = false;
      activeLayers.delete(layerIdRef.current);
      markAppHistoryUnwind();
      window.history.back();
    }
    onBackRef.current();
  }, []);
}
