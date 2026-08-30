package io.github.shalloweryin.semesterschedule;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android-authoritative focus clock and screen-pinning bridge.
 *
 * The elapsed clock is based on SystemClock.elapsedRealtime(), so changing the wall clock cannot
 * jump a running session. Anchors are persisted and survive WebView/activity recreation during the
 * same device boot. Lock mode uses Android's real lock-task/screen-pinning API instead of a CSS-only
 * overlay; Android still intentionally lets the device owner unpin with the system key gesture.
 */
@CapacitorPlugin(name = "FocusNativeTimer")
public class FocusNativeTimerPlugin extends Plugin {
    static final String PREFS = "focus-native-timer";
    static final String ACTIVE = "active";
    static final String OWNER = "owner";
    static final String MODE = "mode";
    static final String TITLE = "title";
    static final String LINKED_EVENT = "linked-event";
    static final String PLANNED = "planned";
    static final String ELAPSED_BASE = "elapsed-base";
    static final String ANCHOR_REALTIME = "anchor-realtime";
    static final String ANCHOR_WALL = "anchor-wall";
    static final String ANCHOR_BOOT = "anchor-boot";
    static final String PAUSED = "paused";
    static final String PLAN_ID = "pomodoro-plan-id";
    static final String ROUND = "pomodoro-round";
    static final String TOTAL_ROUNDS = "pomodoro-total-rounds";
    static final String SHORT_BREAK = "pomodoro-short-break";
    static final String LONG_BREAK = "pomodoro-long-break";
    static final String LONG_INTERVAL = "pomodoro-long-interval";
    static final String AUTO_BREAK = "pomodoro-auto-break";
    static final String REST_KIND = "pomodoro-rest-kind";
    static final String FOCUS_SECONDS = "pomodoro-focus-seconds";
    static final String TASK_TITLE = "pomodoro-task-title";
    static final String SOUND = "sound-enabled";
    static final String TRANSITIONS = "transitions";
    static final Object TRANSITION_LOCK = new Object();
    private static final Object TIMER_STATE_LOCK = new Object();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        long initialElapsed = Math.max(0, readLong(call, "initialElapsedSeconds", 0));
        String planId = call.getString("pomodoroPlanId", "");
        JSObject state;
        synchronized (TIMER_STATE_LOCK) {
            prefs().edit()
                .putBoolean(ACTIVE, true)
                .putString(OWNER, call.getString("ownerId", ""))
                .putString(MODE, call.getString("mode", "pomodoro"))
                .putString(TITLE, call.getString("title", ""))
                .putString(LINKED_EVENT, call.getString("linkedEventId", ""))
                .putLong(PLANNED, readLong(call, "plannedSeconds", -1))
                .putLong(ELAPSED_BASE, initialElapsed)
                .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                .putLong(ANCHOR_WALL, System.currentTimeMillis())
                .putLong(ANCHOR_BOOT, bootCount(getContext()))
                .putBoolean(PAUSED, false)
                .putString(PLAN_ID, planId)
                .putInt(ROUND, call.getInt("pomodoroRound", 0))
                .putInt(TOTAL_ROUNDS, call.getInt("pomodoroTotalRounds", 0))
                .putLong(SHORT_BREAK, readLong(call, "pomodoroShortBreakSeconds", 300))
                .putLong(LONG_BREAK, readLong(call, "pomodoroLongBreakSeconds", 900))
                .putInt(LONG_INTERVAL, call.getInt("pomodoroLongBreakInterval", 4))
                .putBoolean(AUTO_BREAK, call.getBoolean("pomodoroAutoStartBreak", true))
                .putString(REST_KIND, call.getString("pomodoroRestKind", ""))
                .putLong(FOCUS_SECONDS, readLong(call, "pomodoroFocusSeconds", Math.max(0, readLong(call, "plannedSeconds", 0))))
                .putString(TASK_TITLE, readTaskTitle(call))
                .putBoolean(SOUND, call.getBoolean("soundEnabled", true))
                .apply();
            if (!planId.isEmpty()) FocusTimerService.start(getContext());
            state = readState();
        }
        call.resolve(state);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        String expectedOwner = call.getString("ownerId", "");
        JSObject state;
        synchronized (TIMER_STATE_LOCK) {
            SharedPreferences current = prefs();
            if (matchesOwner(current, expectedOwner)
                && current.getBoolean(ACTIVE, false)
                && !current.getBoolean(PAUSED, false)) {
                current.edit()
                    .putLong(ELAPSED_BASE, currentElapsedSeconds(current))
                    .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                    .putLong(ANCHOR_WALL, System.currentTimeMillis())
                    .putLong(ANCHOR_BOOT, bootCount(getContext()))
                    .putBoolean(PAUSED, true)
                    .apply();
            }
            state = readState();
        }
        call.resolve(state);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        String expectedOwner = call.getString("ownerId", "");
        JSObject state;
        synchronized (TIMER_STATE_LOCK) {
            SharedPreferences current = prefs();
            if (matchesOwner(current, expectedOwner)
                && current.getBoolean(ACTIVE, false)
                && current.getBoolean(PAUSED, false)) {
                current.edit()
                    .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                    .putLong(ANCHOR_WALL, System.currentTimeMillis())
                    .putLong(ANCHOR_BOOT, bootCount(getContext()))
                    .putBoolean(PAUSED, false)
                    .apply();
            }
            state = readState();
        }
        call.resolve(state);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(readState());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SharedPreferences current = prefs();
        String expectedOwner = call.getString("ownerId", "");
        JSObject result = new JSObject();
        if (!matchesOwner(current, expectedOwner)) {
            result.put("stopped", false);
            call.resolve(result);
            return;
        }
        Runnable stopTimer = () -> {
            boolean stopped = false;
            synchronized (TIMER_STATE_LOCK) {
                SharedPreferences executionState = prefs();
                if (matchesOwner(executionState, expectedOwner)) {
                    Activity activity = getActivity();
                    if (call.getBoolean("exitLockTask", false) && activity != null) {
                        try {
                            if (isLockTaskActive()) activity.stopLockTask();
                        } catch (Exception ignored) {
                            // The owner may already have unpinned with the system gesture.
                        }
                        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                    executionState.edit().putBoolean(ACTIVE, false).apply();
                    FocusTimerService.stop(getContext());
                    stopped = true;
                }
            }
            result.put("stopped", stopped);
            call.resolve(result);
        };
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(stopTimer);
        else stopTimer.run();
    }

    @PluginMethod
    public void drainTransitions(PluginCall call) {
        String encoded = prefs().getString(TRANSITIONS, "[]");
        try {
            JSObject result = new JSObject();
            result.put("transitions", new JSArray(encoded));
            prefs().edit().putString(TRANSITIONS, "[]").apply();
            call.resolve(result);
        } catch (Exception error) {
            call.reject("读取番茄阶段记录失败", error);
        }
    }

    @PluginMethod
    public void getTransitions(PluginCall call) {
        try {
            JSObject result = new JSObject();
            synchronized (TRANSITION_LOCK) {
                result.put("transitions", new JSArray(prefs().getString(TRANSITIONS, "[]")));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("读取番茄阶段记录失败", error);
        }
    }

    @PluginMethod
    public void clearTransitions(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids", new JSArray());
            java.util.Set<String> acknowledged = new java.util.HashSet<>();
            for (int index = 0; index < ids.length(); index += 1) {
                acknowledged.add(ids.getString(index));
            }
            synchronized (TRANSITION_LOCK) {
                JSArray current = new JSArray(prefs().getString(TRANSITIONS, "[]"));
                JSArray remaining = new JSArray();
                for (int index = 0; index < current.length(); index += 1) {
                    org.json.JSONObject item = current.optJSONObject(index);
                    if (item != null && !acknowledged.contains(item.optString("id"))) remaining.put(item);
                }
                prefs().edit().putString(TRANSITIONS, remaining.toString()).apply();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("确认番茄阶段记录失败", error);
        }
    }

    @PluginMethod
    public void enterLockTask(PluginCall call) {
        String expectedOwner = call.getString("ownerId", "");
        if (!matchesOwner(prefs(), expectedOwner)) {
            JSObject result = new JSObject();
            result.put("active", false);
            call.resolve(result);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                JSObject result = new JSObject();
                synchronized (TIMER_STATE_LOCK) {
                    if (!matchesOwner(prefs(), expectedOwner)) {
                        result.put("active", false);
                    } else {
                        activity.startLockTask();
                        result.put("active", isLockTaskActive());
                    }
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("lock-task-failed", error);
            }
        });
    }

    @PluginMethod
    public void exitLockTask(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (isLockTaskActive()) activity.stopLockTask();
            } catch (Exception ignored) {
                // The system may already have been unpinned by its hardware-key gesture.
            }
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            JSObject result = new JSObject();
            result.put("active", isLockTaskActive());
            call.resolve(result);
        });
    }

    private JSObject readState() {
        SharedPreferences current = prefs();
        JSObject state = new JSObject();
        state.put("active", current.getBoolean(ACTIVE, false));
        state.put("ownerId", current.getString(OWNER, ""));
        state.put("mode", current.getString(MODE, "pomodoro"));
        state.put("title", current.getString(TITLE, ""));
        state.put("linkedEventId", current.getString(LINKED_EVENT, ""));
        state.put("plannedSeconds", current.getLong(PLANNED, -1));
        state.put("elapsedSeconds", currentElapsedSeconds(current));
        state.put("startedAt", current.getLong(ANCHOR_WALL, 0) - current.getLong(ELAPSED_BASE, 0) * 1000L);
        state.put("paused", current.getBoolean(PAUSED, false));
        state.put("pomodoroPlanId", current.getString(PLAN_ID, ""));
        state.put("pomodoroRound", current.getInt(ROUND, 0));
        state.put("pomodoroTotalRounds", current.getInt(TOTAL_ROUNDS, 0));
        state.put("pomodoroShortBreakSeconds", current.getLong(SHORT_BREAK, 300));
        state.put("pomodoroLongBreakSeconds", current.getLong(LONG_BREAK, 900));
        state.put("pomodoroLongBreakInterval", current.getInt(LONG_INTERVAL, 4));
        state.put("pomodoroAutoStartBreak", current.getBoolean(AUTO_BREAK, true));
        state.put("pomodoroRestKind", current.getString(REST_KIND, ""));
        state.put("pomodoroFocusSeconds", current.getLong(FOCUS_SECONDS, 0));
        state.put("pomodoroTaskTitle", current.getString(TASK_TITLE, ""));
        state.put("lockTaskActive", isLockTaskActive());
        return state;
    }

    private String readTaskTitle(PluginCall call) {
        String explicit = call.getString("pomodoroTaskTitle", "");
        if (explicit != null && !explicit.isEmpty()) return explicit;
        String mode = call.getString("mode", "pomodoro");
        return "pomodoro".equals(mode) ? call.getString("title", "") : "";
    }

    private boolean matchesOwner(SharedPreferences current, String expectedOwner) {
        return expectedOwner.isEmpty() || expectedOwner.equals(current.getString(OWNER, ""));
    }

    private long currentElapsedSeconds(SharedPreferences current) {
        return readElapsedSeconds(getContext(), current);
    }

    static long readElapsedSeconds(Context context) {
        return readElapsedSeconds(context, context.getSharedPreferences(PREFS, Context.MODE_PRIVATE));
    }

    static long readElapsedSeconds(Context context, SharedPreferences current) {
        long base = Math.max(0, current.getLong(ELAPSED_BASE, 0));
        if (!current.getBoolean(ACTIVE, false) || current.getBoolean(PAUSED, false)) return base;
        long anchorBoot = current.getLong(ANCHOR_BOOT, bootCount(context));
        long currentBoot = bootCount(context);
        long delta;
        if (anchorBoot == currentBoot) {
            long anchor = current.getLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime());
            delta = SystemClock.elapsedRealtime() - anchor;
        } else {
            // elapsedRealtime intentionally resets at reboot. Fall back to the persisted wall anchor
            // only across a proven boot change so normal manual clock changes cannot jump the timer.
            long wallAnchor = current.getLong(ANCHOR_WALL, System.currentTimeMillis());
            delta = System.currentTimeMillis() - wallAnchor;
        }
        if (delta < 0) return base;
        return base + delta / 1000;
    }

    static long bootCount(Context context) {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Exception ignored) {
            return -1;
        }
    }

    private boolean isLockTaskActive() {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    private long readLong(PluginCall call, String key, long fallback) {
        Object value = call.getData() != null ? call.getData().opt(key) : null;
        if (value instanceof Number) return Math.round(((Number) value).doubleValue());
        if (value instanceof String) {
            try { return Math.round(Double.parseDouble((String) value)); }
            catch (NumberFormatException ignored) { return fallback; }
        }
        return fallback;
    }
}
