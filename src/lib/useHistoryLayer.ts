import { useCallback, useEffect, useRef } from "react";
import { appHistoryLayer, isCurrentAppHistoryLayer, pushAppHistoryLayer } from "./appHistory";

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
        window.history.back();
      }
    };
  }, [open]);

  return useCallback(() => {
    if (pushedRef.current && isCurrentAppHistoryLayer(layerIdRef.current)) {
      window.history.back();
      return;
    }
    onBackRef.current();
  }, []);
}
