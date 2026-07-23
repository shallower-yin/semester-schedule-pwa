package io.github.shalloweryin.semesterschedule;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** Foreground-service-owned focus overlay that survives Activity/WebView destruction. */
public class FocusOverlayService extends Service {
    public static final String ACTION_SHOW = "focus.overlay.SHOW";
    public static final String ACTION_UPDATE = "focus.overlay.UPDATE";
    public static final String ACTION_HIDE = "focus.overlay.HIDE";
    private static final String CHANNEL_ID = "focus-status-v2";
    private static final int NOTIFICATION_ID = 31_001;
    private static final String PREFS = "focus_overlay_state";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private WindowManager.LayoutParams layoutParams;
    private View overlayView;
    private TextView timeView;
    private TextView labelView;
    private Runnable ticker;
    private long startedAt;
    private double pausedSeconds;
    private long pauseStartedAt = -1;
    private long plannedSeconds = -1;
    private String label = "专注";
    private String title = "";

    public static void show(Context context, Intent payload) {
        payload.setClass(context, FocusOverlayService.class).setAction(ACTION_SHOW);
        ContextCompat.startForegroundService(context, payload);
    }

    public static void update(Context context, Intent payload) {
        payload.setClass(context, FocusOverlayService.class).setAction(ACTION_UPDATE);
        ContextCompat.startForegroundService(context, payload);
    }

    public static void hide(Context context) {
        Intent intent = new Intent(context, FocusOverlayService.class).setAction(ACTION_HIDE);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_HIDE.equals(action)) {
            clearPersistedState();
            removeOverlay();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && (ACTION_SHOW.equals(action) || ACTION_UPDATE.equals(action))) {
            applyIntent(intent);
            persistState();
        } else {
            restoreState();
        }
        if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("active", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        if (!Settings.canDrawOverlays(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        ensureOverlay();
        render();
        startTicking();
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        removeOverlay();
        super.onDestroy();
    }

    private void applyIntent(Intent intent) {
        startedAt = intent.getLongExtra("startedAt", System.currentTimeMillis());
        pausedSeconds = intent.getDoubleExtra("pausedSeconds", 0);
        pauseStartedAt = intent.getLongExtra("pauseStartedAt", -1);
        plannedSeconds = intent.getLongExtra("plannedSeconds", -1);
        label = intent.getStringExtra("label") == null ? "专注" : intent.getStringExtra("label");
        title = intent.getStringExtra("title") == null ? "" : intent.getStringExtra("title");
    }

    private void persistState() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("active", true)
            .putLong("startedAt", startedAt)
            .putLong("pausedBits", Double.doubleToRawLongBits(pausedSeconds))
            .putLong("pauseStartedAt", pauseStartedAt)
            .putLong("plannedSeconds", plannedSeconds)
            .putString("label", label)
            .putString("title", title)
            .apply();
    }

    private void restoreState() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean("active", false)) return;
        startedAt = prefs.getLong("startedAt", System.currentTimeMillis());
        pausedSeconds = Double.longBitsToDouble(prefs.getLong("pausedBits", Double.doubleToRawLongBits(0)));
        pauseStartedAt = prefs.getLong("pauseStartedAt", -1);
        plannedSeconds = prefs.getLong("plannedSeconds", -1);
        label = prefs.getString("label", "专注");
        title = prefs.getString("title", "");
    }

    private void clearPersistedState() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
    }

    private void ensureOverlay() {
        if (overlayView != null || windowManager == null) return;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        int horizontal = dp(18);
        root.setPadding(horizontal, dp(12), horizontal, dp(12));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(20, 31, 57));
        background.setStroke(dp(1), Color.rgb(72, 101, 167));
        background.setCornerRadius(dp(18));
        root.setBackground(background);

        labelView = new TextView(this);
        labelView.setTextColor(Color.rgb(159, 183, 248));
        labelView.setTextSize(12);
        labelView.setMaxLines(1);
        root.addView(labelView);

        timeView = new TextView(this);
        timeView.setTextColor(Color.WHITE);
        timeView.setTextSize(30);
        timeView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        root.addView(timeView);

        root.setOnClickListener(view -> openFocusPage());
        root.setOnTouchListener(new View.OnTouchListener() {
            private float downRawX;
            private float downRawY;
            private int downX;
            private int downY;
            private boolean moved;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                if (layoutParams == null || windowManager == null) return false;
                if (event.getAction() == MotionEvent.ACTION_DOWN) {
                    downRawX = event.getRawX();
                    downRawY = event.getRawY();
                    downX = layoutParams.x;
                    downY = layoutParams.y;
                    moved = false;
                    return true;
                }
                if (event.getAction() == MotionEvent.ACTION_MOVE) {
                    int dx = Math.round(event.getRawX() - downRawX);
                    int dy = Math.round(event.getRawY() - downRawY);
                    moved = moved || Math.abs(dx) > dp(4) || Math.abs(dy) > dp(4);
                    layoutParams.x = downX + dx;
                    layoutParams.y = downY + dy;
                    windowManager.updateViewLayout(overlayView, layoutParams);
                    return true;
                }
                if (event.getAction() == MotionEvent.ACTION_UP) {
                    if (!moved) view.performClick();
                    return true;
                }
                return false;
            }
        });

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = dp(18);
        layoutParams.y = dp(120);
        overlayView = root;
        windowManager.addView(root, layoutParams);
    }

    private void render() {
        // The same monotonic Android timer drives both the WebView lock screen and this cross-app
        // overlay, so wall-clock changes and Activity/WebView destruction cannot move them apart.
        long elapsed = FocusNativeTimerPlugin.readElapsedSeconds(this);
        long display = plannedSeconds >= 0 ? Math.max(0, plannedSeconds - elapsed) : elapsed;
        if (timeView != null) timeView.setText(formatDuration(display));
        if (labelView != null) {
            String state = pauseStartedAt >= 0 ? "已暂停" : label;
            labelView.setText(title == null || title.trim().isEmpty() ? state : state + " · " + title.trim());
        }
    }

    private void startTicking() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = new Runnable() {
            @Override
            public void run() {
                render();
                handler.postDelayed(this, 1000);
            }
        };
        handler.post(ticker);
    }

    private void removeOverlay() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = null;
        if (overlayView != null && windowManager != null) {
            try { windowManager.removeView(overlayView); } catch (Exception ignored) { }
        }
        overlayView = null;
        timeView = null;
        labelView = null;
    }

    private void openFocusPage() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setAction(Intent.ACTION_VIEW);
        launch.setData(Uri.parse("semesterschedule://focus"));
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launch);
    }

    private android.app.Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setAction(Intent.ACTION_VIEW);
        launch.setData(Uri.parse("semesterschedule://focus"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle((label == null || label.trim().isEmpty() ? "专注" : label.trim()) + "计时正在运行")
            .setContentText("轻点返回专注页面")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pending)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.deleteNotificationChannel("focus-overlay-v1");
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "专注悬浮计时", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("保持跨应用专注计时器运行");
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String formatDuration(long seconds) {
        long safe = Math.max(0, seconds);
        long hours = safe / 3600;
        long minutes = (safe % 3600) / 60;
        long secs = safe % 60;
        return String.format(java.util.Locale.US, "%02d:%02d:%02d", hours, minutes, secs);
    }
}
