package io.github.shalloweryin.semesterschedule;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.content.pm.ActivityInfo;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Draws a small, draggable focus-countdown card on top of other apps using the system overlay
 * (SYSTEM_ALERT_WINDOW). The browser build keeps using picture-in-picture; the WebView cannot, so
 * the APK routes the "system window" action here. The card ticks itself from the timer anchors, so it
 * keeps counting while the WebView is backgrounded. A tap brings the app forward (to its immersive
 * in-app fullscreen); the card intentionally does NOT expand into its own fullscreen anymore, which
 * previously showed an unstyled all-black screen that looked wrong, especially in landscape.
 */
@CapacitorPlugin(name = "FocusOverlay")
public class FocusOverlayPlugin extends Plugin {

    private WindowManager windowManager;
    private View overlayView;
    private TextView labelView;
    private TextView timeView;
    private TextView titleView;
    private WindowManager.LayoutParams layoutParams;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable ticker;

    private long startedAt = System.currentTimeMillis();
    private double pausedSeconds = 0;
    private long pauseStartedAt = -1; // >= 0 while paused
    private long plannedSeconds = -1; // < 0 for an open-ended stopwatch
    private String modeLabel = "专注";
    private String taskTitle = "";
    private boolean showing = false;
    private boolean immersive = false;
    private int cardX = 0;
    private int cardY = 0;

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canDraw());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (canDraw()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        ret.put("granted", canDraw());
        call.resolve(ret);
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (!canDraw()) {
            call.reject("overlay-permission-denied");
            return;
        }
        FocusOverlayService.show(getContext(), serviceIntent(call));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (canDraw()) FocusOverlayService.update(getContext(), serviceIntent(call));
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        FocusOverlayService.hide(getContext());
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        // The foreground service owns the cross-app window; destroying the WebView must not stop it.
        super.handleOnDestroy();
    }

    private Intent serviceIntent(PluginCall call) {
        Intent intent = new Intent();
        intent.putExtra("startedAt", readLong(call, "startedAt", System.currentTimeMillis()));
        intent.putExtra("pausedSeconds", readDouble(call, "pausedSeconds", 0));
        intent.putExtra("pauseStartedAt", readLong(call, "pauseStartedAt", -1));
        intent.putExtra("plannedSeconds", readLong(call, "plannedSeconds", -1));
        intent.putExtra("label", call.getString("label", "专注"));
        intent.putExtra("title", call.getString("title", ""));
        return intent;
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        final boolean enable = "true".equals(call.getString("enabled", "false"));
        immersive = enable;
        activity.runOnUiThread(() -> {
            int flags = activity.getWindow().getDecorView().getSystemUiVisibility();
            if (enable) {
                flags |= View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                }
            } else {
                flags &= ~(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            activity.getWindow().getDecorView().setSystemUiVisibility(flags);
        });
        call.resolve();
    }

    @PluginMethod
    public void setOrientation(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        String mode = call.getString("mode", "auto");
        int orientation;
        if ("landscape".equals(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        } else if ("portrait".equals(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        } else {
            orientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        activity.runOnUiThread(() -> activity.setRequestedOrientation(orientation));
        call.resolve();
    }

    private boolean canDraw() {
        return Settings.canDrawOverlays(getContext());
    }

    private void applyAnchors(
        long nextStartedAt,
        double nextPausedSeconds,
        long nextPauseStartedAt,
        long nextPlannedSeconds,
        String nextLabel,
        String nextTitle
    ) {
        startedAt = nextStartedAt;
        pausedSeconds = nextPausedSeconds;
        pauseStartedAt = nextPauseStartedAt;
        plannedSeconds = nextPlannedSeconds;
        modeLabel = nextLabel != null ? nextLabel : "专注";
        taskTitle = nextTitle != null ? nextTitle : "";
    }

    /**
     * Capacitor's PluginCall.getDouble/getLong only accept a subset of JSON number types.
     * JS millisecond timestamps arrive as Long (they do not fit in Integer) and getDouble()
     * silently falls back — previously that fallback was "now", which reset every countdown.
     * Accept any Number (and numeric String) so anchors stay stable across show/update/pause.
     */
    private long readLong(PluginCall call, String key, long fallback) {
        Object value = call.getData() != null ? call.getData().opt(key) : null;
        if (value == null || value == org.json.JSONObject.NULL) {
            return fallback;
        }
        if (value instanceof Number) {
            return Math.round(((Number) value).doubleValue());
        }
        if (value instanceof String) {
            try {
                return Math.round(Double.parseDouble((String) value));
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private double readDouble(PluginCall call, String key, double fallback) {
        Object value = call.getData() != null ? call.getData().opt(key) : null;
        if (value == null || value == org.json.JSONObject.NULL) {
            return fallback;
        }
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        if (value instanceof String) {
            try {
                return Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private void ensureOverlay(Context context) {
        if (overlayView != null) {
            return;
        }
        windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);

        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(context, 16), dp(context, 12), dp(context, 16), dp(context, 12));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.parseColor("#F2101827"));
        background.setCornerRadius(dp(context, 18));
        root.setBackground(background);

        labelView = new TextView(context);
        labelView.setTextColor(Color.parseColor("#9FB7F8"));
        labelView.setTextSize(12);
        root.addView(labelView);

        timeView = new TextView(context);
        timeView.setTextColor(Color.WHITE);
        timeView.setTextSize(30);
        timeView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        root.addView(timeView);

        titleView = new TextView(context);
        titleView.setTextColor(Color.parseColor("#DBE5FF"));
        titleView.setTextSize(12);
        titleView.setMaxLines(1);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            dp(context, 168), LinearLayout.LayoutParams.WRAP_CONTENT);
        titleView.setLayoutParams(titleParams);
        root.addView(titleView);

        TextView hintView = new TextView(context);
        hintView.setTextColor(Color.parseColor("#8FA6D9"));
        hintView.setTextSize(11);
        hintView.setText("轻点回到应用");
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintParams.topMargin = dp(context, 6);
        hintView.setLayoutParams(hintParams);
        root.addView(hintView);

        overlayView = root;

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        cardX = dp(context, 16);
        cardY = dp(context, 140);
        layoutParams.x = cardX;
        layoutParams.y = cardY;

        attachDragAndTap(context);
    }

    private void attachDragAndTap(Context context) {
        overlayView.setOnTouchListener(new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;
            private boolean dragged;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX();
                        downY = event.getRawY();
                        startX = layoutParams.x;
                        startY = layoutParams.y;
                        dragged = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (event.getRawX() - downX);
                        int dy = (int) (event.getRawY() - downY);
                        if (Math.abs(dx) > dp(context, 4) || Math.abs(dy) > dp(context, 4)) {
                            dragged = true;
                        }
                        layoutParams.x = startX + dx;
                        layoutParams.y = startY + dy;
                        if (windowManager != null && showing) {
                            windowManager.updateViewLayout(overlayView, layoutParams);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (dragged) {
                            // Remember where the user parked the card.
                            cardX = layoutParams.x;
                            cardY = layoutParams.y;
                            return true;
                        }
                        // A plain tap (or long press) returns to the app and its immersive fullscreen.
                        bringAppToFront(context);
                        return true;
                    default:
                        return false;
                }
            }
        });
    }

    private void bringAppToFront(Context context) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(intent);
        }
    }

    private void render() {
        long now = System.currentTimeMillis();
        double currentPause = pauseStartedAt >= 0 ? Math.max(0, (now - pauseStartedAt) / 1000.0) : 0;
        long wallElapsed = (long) Math.max(0, Math.floor((now - startedAt) / 1000.0 - pausedSeconds - currentPause));
        // The APK timer owns an elapsedRealtime-based clock. Prefer it so manual clock changes and
        // WebView throttling cannot jump the system overlay; keep the wall-clock fallback for old
        // active sessions created before the native timer bridge existed.
        long nativeElapsed = FocusNativeTimerPlugin.readElapsedSeconds(getContext());
        long elapsed = nativeElapsed > 0 || wallElapsed == 0 ? nativeElapsed : wallElapsed;
        long display = plannedSeconds >= 0 ? Math.max(0, plannedSeconds - elapsed) : elapsed;
        if (timeView != null) {
            timeView.setText(formatDuration(display));
        }
        if (labelView != null) {
            labelView.setText(pauseStartedAt >= 0 ? "已暂停" : modeLabel);
        }
        if (titleView != null) {
            titleView.setText(taskTitle);
        }
    }

    private void startTicking() {
        stopTicking();
        ticker = new Runnable() {
            @Override
            public void run() {
                if (!showing) {
                    return;
                }
                render();
                handler.postDelayed(this, 1000);
            }
        };
        handler.post(ticker);
    }

    private void stopTicking() {
        if (ticker != null) {
            handler.removeCallbacks(ticker);
            ticker = null;
        }
    }

    private void removeOverlay() {
        stopTicking();
        if (showing && overlayView != null && windowManager != null) {
            try {
                windowManager.removeView(overlayView);
            } catch (Exception ignored) {
                // Nothing to remove.
            }
        }
        showing = false;
    }

    private String formatDuration(long totalSeconds) {
        long seconds = Math.max(0, totalSeconds);
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;
        long rest = seconds % 60;
        if (hours > 0) {
            return String.format("%02d:%02d:%02d", hours, minutes, rest);
        }
        return String.format("%02d:%02d", minutes, rest);
    }

    private int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
