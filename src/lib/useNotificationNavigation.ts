import { useEffect, useRef, useState } from "react";
import type { Anniversary, EventItem, PageId, TodoItem } from "../types";
import { isAppHistoryUnwinding } from "./appHistory";
import { consumePendingNativeNotificationKey, NATIVE_NOTIFICATION_OPEN_EVENT } from "./nativeApp";
import { showToast } from "./toast";

interface NotificationNavigationInput {
  ownerId: string;
  authReady: boolean;
  events: EventItem[] | undefined;
  anniversaries: Anniversary[] | undefined;
  todos: TodoItem[] | undefined;
}

interface NotificationNavigationActions {
  navigate: (page: PageId) => void;
  goToday: () => void;
  openQuickEntry: () => void;
  createTodo: () => void;
  openEvent: (event: EventItem) => void;
  openAnniversary: (id: string) => void;
  openTodo: (id: string) => void;
}

/** Consume browser/native links once, waiting for the current owner's data. */
export function useNotificationNavigation(
  { ownerId, authReady, events, anniversaries, todos }: NotificationNavigationInput,
  actions: NotificationNavigationActions
): void {
  const [notificationKey, setNotificationKey] = useState(() => consumePendingNativeNotificationKey());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handleOpen = (event: Event) => setNotificationKey((event as CustomEvent<string>).detail || null);
    window.addEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, handleOpen);
    const pending = consumePendingNativeNotificationKey();
    if (pending) setNotificationKey(pending);
    return () => window.removeEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    const consumeNotificationFromUrl = () => {
      if (isAppHistoryUnwinding()) return;
      const url = new URL(window.location.href);
      const key = url.searchParams.get("notification")?.trim();
      if (!key) return;
      url.searchParams.delete("notification");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setNotificationKey(key);
    };
    consumeNotificationFromUrl();
    window.addEventListener("popstate", consumeNotificationFromUrl);
    return () => window.removeEventListener("popstate", consumeNotificationFromUrl);
  }, []);

  useEffect(() => {
    if (!notificationKey) return;
    const current = actionsRef.current;
    if (notificationKey === "route:quick-entry") {
      if (!authReady) return;
      current.openQuickEntry();
    } else if (notificationKey === "route:today") {
      current.goToday();
      current.navigate("today");
    } else if (notificationKey === "route:todos") {
      current.navigate("todos");
    } else if (notificationKey === "route:todos-create") {
      if (!authReady) return;
      current.navigate("todos");
      current.createTodo();
    } else if (notificationKey === "route:focus") {
      current.navigate("focus");
    } else {
      const eventMatch = /^event:([^:]+):/.exec(notificationKey);
      const anniversaryMatch = /^anniversary:([^:]+):/.exec(notificationKey);
      const todoMatch = /^todo:([^:]+)$/.exec(notificationKey);
      if (eventMatch) {
        if (!authReady || events === undefined) return;
        const target = events.find((item) => item.id === eventMatch[1] && item.user_id === ownerId);
        current.navigate(target?.event_type === "habit" ? "habits" : "calendar");
        if (target) current.openEvent(target);
        else showToast("这条提醒对应的事项已被删除。", "info");
      } else if (anniversaryMatch) {
        if (!authReady || anniversaries === undefined) return;
        if (anniversaries.some((item) => item.id === anniversaryMatch[1] && item.user_id === ownerId)) {
          current.navigate("anniversaries");
          current.openAnniversary(anniversaryMatch[1]);
        } else {
          showToast("这条提醒对应的日子已被删除。", "info");
        }
      } else if (todoMatch) {
        if (!authReady || todos === undefined) return;
        current.navigate("todos");
        if (todos.some((item) => item.id === todoMatch[1] && item.user_id === ownerId)) {
          current.openTodo(todoMatch[1]);
        } else {
          showToast("这条提醒对应的待办已被删除。", "info");
        }
      } else if (notificationKey === "health") {
        current.navigate("health");
      }
    }
    setNotificationKey(null);
  }, [anniversaries, authReady, events, notificationKey, ownerId, todos]);
}
