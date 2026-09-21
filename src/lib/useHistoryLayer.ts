import { useCallback, useEffect, useRef } from "react";
import { appHistoryLayer, isAppHistoryUnwinding, isCurrentAppHistoryLayer, markAppHistoryUnwind, pushAppHistoryLayer } from "./appHistory";

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
      pushedRef.current = true;
    }, 0);

    const handlePopState = (event: PopStateEvent) => {
      if (isAppHistoryUnwinding()) return;
      if (!pushedRef.current || appHistoryLayer(event.state) === layerId) return;
      pushedRef.current = false;
      onBackRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", handlePopState);
      if (pushedRef.current && isCurrentAppHistoryLayer(layerId)) {
        pushedRef.current = false;
        markAppHistoryUnwind();
        window.history.back();
      }
    };
  }, [open]);

  return useCallback(() => {
    if (pushedRef.current && isCurrentAppHistoryLayer(layerIdRef.current)) {
      markAppHistoryUnwind();
      window.history.back();
      return;
    }
    onBackRef.current();
  }, []);
}
