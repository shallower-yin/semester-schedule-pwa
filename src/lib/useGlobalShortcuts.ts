import { useEffect, useRef } from "react";

export interface GlobalShortcutHandlers {
  onSearch: () => void;
  onNewToday: () => void;
  onQuickEntry: () => void;
  onScheduleAssistant: () => void;
  onAssistant: () => void;
  onMindMap: () => void;
  onToday: () => void;
  onEscape: () => void;
}

const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

/**
 * Global keyboard shortcuts for the desktop shell. Handlers are kept in a ref so the listener is
 * registered once and always calls the latest closures, without resubscribing on every render.
 * Shortcuts are suppressed while typing in a field (except Escape).
 */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && TYPING_TAGS.includes(target.tagName) && event.key !== "Escape") return;
      const current = handlersRef.current;
      if (event.key === "/") {
        event.preventDefault();
        current.onSearch();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        current.onNewToday();
      } else if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        current.onQuickEntry();
      } else if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        current.onScheduleAssistant();
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        current.onAssistant();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        current.onMindMap();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        current.onToday();
      } else if (event.key === "Escape") {
        current.onEscape();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
