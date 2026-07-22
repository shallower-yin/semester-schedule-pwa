package io.github.shalloweryin.semesterschedule;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.WindowManager;

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
    private static final String PREFS = "focus-native-timer";
    private static final String ACTIVE = "active";
    private static final String OWNER = "owner";
    private static final String MODE = "mode";
    private static final String TITLE = "title";
    private static final String PLANNED = "planned";
    private static final String ELAPSED_BASE = "elapsed-base";
    private static final String ANCHOR_REALTIME = "anchor-realtime";
    private static final String PAUSED = "paused";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        long initialElapsed = Math.max(0, readLong(call, "initialElapsedSeconds", 0));
        prefs().edit()
            .putBoolean(ACTIVE, true)
            .putString(OWNER, call.getString("ownerId", ""))
            .putString(MODE, call.getString("mode", "pomodoro"))
            .putString(TITLE, call.getString("title", ""))
            .putLong(PLANNED, readLong(call, "plannedSeconds", -1))
            .putLong(ELAPSED_BASE, initialElapsed)
            .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
            .putBoolean(PAUSED, false)
            .apply();
        call.resolve(readState());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        SharedPreferences current = prefs();
        if (current.getBoolean(ACTIVE, false) && !current.getBoolean(PAUSED, false)) {
            current.edit()
                .putLong(ELAPSED_BASE, currentElapsedSeconds(current))
                .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                .putBoolean(PAUSED, true)
                .apply();
        }
        call.resolve(readState());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        SharedPreferences current = prefs();
        if (current.getBoolean(ACTIVE, false) && current.getBoolean(PAUSED, false)) {
            current.edit()
                .putLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                .putBoolean(PAUSED, false)
                .apply();
        }
        call.resolve(readState());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(readState());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }

    @PluginMethod
    public void enterLockTask(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                activity.startLockTask();
                JSObject result = new JSObject();
                result.put("active", isLockTaskActive());
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
        state.put("plannedSeconds", current.getLong(PLANNED, -1));
        state.put("elapsedSeconds", currentElapsedSeconds(current));
        state.put("paused", current.getBoolean(PAUSED, false));
        state.put("lockTaskActive", isLockTaskActive());
        return state;
    }

    private long currentElapsedSeconds(SharedPreferences current) {
        return readElapsedSeconds(current);
    }

    static long readElapsedSeconds(Context context) {
        return readElapsedSeconds(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE));
    }

    private static long readElapsedSeconds(SharedPreferences current) {
        long base = Math.max(0, current.getLong(ELAPSED_BASE, 0));
        if (!current.getBoolean(ACTIVE, false) || current.getBoolean(PAUSED, false)) return base;
        long anchor = current.getLong(ANCHOR_REALTIME, SystemClock.elapsedRealtime());
        long delta = SystemClock.elapsedRealtime() - anchor;
        // elapsedRealtime resets on reboot. A negative delta means the old anchor belongs to a prior boot.
        if (delta < 0) return base;
        return base + delta / 1000;
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
