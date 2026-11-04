import { useEffect } from "react";
import { isNativeApp } from "./nativeApp";
import { ScheduleWidget } from "./scheduleWidgetPlugin";
import { consumePendingWidgetCompletionActions } from "./widgetCompletionActions";
import { buildWidgetSnapshot, type WidgetSnapshotInput } from "./widgetSnapshot";

interface ScheduleWidgetBridgeInput extends WidgetSnapshotInput {
  authReady: boolean;
  dataReady: boolean;
}

/** Keep native owner activation independent of the slower account-scoped queries. */
export function useScheduleWidgetBridge(input: ScheduleWidgetBridgeInput): void {
  const {
    authReady, dataReady, ownerId, semester, courses, schedules, cancellations,
    events, categories, occurrenceStates, todos, periods, focusSessions
  } = input;

  useEffect(() => {
    if (!isNativeApp() || !authReady) return;
    let cancelled = false;
    const activateAndConsume = async () => {
      try {
        await ScheduleWidget.setActiveOwner({ ownerId });
        if (!cancelled) await consumePendingWidgetCompletionActions(ownerId);
      } catch {
        // Older Android shells do not expose this optional bridge.
      }
    };
    void activateAndConsume();
    const onForeground = () => {
      if (document.visibilityState === "visible") void activateAndConsume();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onForeground);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [authReady, ownerId]);

  // Publish only after all relevant live queries have returned for this owner.
  useEffect(() => {
    if (!isNativeApp() || !dataReady) return;
    let cancelled = false;
    const publish = async () => {
      try {
        // Re-activating the same owner is idempotent in the native bridge.
        await ScheduleWidget.setActiveOwner({ ownerId });
        if (cancelled) return;
        const snapshot = buildWidgetSnapshot({
          ownerId, semester, courses, schedules, cancellations, events,
          categories, occurrenceStates, todos, periods, focusSessions
        }, new Date());
        await ScheduleWidget.updateSnapshot({
          ownerId,
          snapshotJson: JSON.stringify({ ...snapshot, ownerId })
        });
      } catch {
        // Widget support is best-effort and must not block schedule editing.
      }
    };
    void publish();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void publish();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onVisibilityChange);
    };
  }, [
    authReady, categories, cancellations, courses, events, focusSessions,
    ownerId, occurrenceStates, todos, periods, schedules, semester, dataReady
  ]);
}
