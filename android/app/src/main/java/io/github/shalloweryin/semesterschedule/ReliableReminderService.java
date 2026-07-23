package io.github.shalloweryin.semesterschedule;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * User-visible foreground guard for reminder reliability. Exact alarms remain authoritative; this
 * service raises process importance and keeps a durable heartbeat so OEM background kills are
 * observable. It deliberately shares the single high-priority silent reminder channel.
 */
public class ReliableReminderService extends Service {
    private static final String PREFS = "reliable_reminder_service_v1";
    private static final String ENABLED = "enabled";
    private static final String LAST_HEARTBEAT = "lastHeartbeatAt";
    private static final String START_COUNT = "startCount";
    private static final String ACTION_RESTART = "io.github.shalloweryin.semesterschedule.RELIABLE_REMINDER_RESTART";
    private static final int NOTIFICATION_ID = 31_010;
    private static final int RESTART_REQUEST_ID = 31_011;
    private static final long HEARTBEAT_MS = 60_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            markHeartbeat(ReliableReminderService.this);
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    public static void start(Context context) {
        prefs(context).edit().putBoolean(ENABLED, true).apply();
        ContextCompat.startForegroundService(context, new Intent(context, ReliableReminderService.class));
    }

    public static void stop(Context context) {
        prefs(context).edit().putBoolean(ENABLED, false).apply();
        cancelRestart(context);
        context.stopService(new Intent(context, ReliableReminderService.class));
    }

    public static void restoreIfEnabled(Context context) {
        if (isEnabled(context)) scheduleRestart(context, 10_000L);
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(ENABLED, false);
    }

    public static boolean isRunning(Context context) {
        long heartbeat = lastHeartbeatAt(context);
        return isEnabled(context) && heartbeat > 0 && System.currentTimeMillis() - heartbeat < HEARTBEAT_MS * 3;
    }

    public static long lastHeartbeatAt(Context context) {
        return prefs(context).getLong(LAST_HEARTBEAT, 0L);
    }

    public static int startCount(Context context) {
        return prefs(context).getInt(START_COUNT, 0);
    }

    @Override public void onCreate() {
        super.onCreate();
        ReminderSupportPlugin.ensureChannel(this);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        SharedPreferences state = prefs(this);
        state.edit().putInt(START_COUNT, state.getInt(START_COUNT, 0) + 1).apply();
        markHeartbeat(this);
        startForeground(NOTIFICATION_ID, notification());
        handler.removeCallbacks(heartbeat);
        handler.postDelayed(heartbeat, HEARTBEAT_MS);
        ReminderAlarmReceiver.recordDiagnostic(this, "service_started", 0, String.valueOf(startCount(this)));
        return START_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        if (isEnabled(this)) {
            ReminderAlarmReceiver.recordDiagnostic(this, "task_removed", 0, "");
            scheduleRestart(this, 2_000L);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(heartbeat);
        if (isEnabled(this)) {
            ReminderAlarmReceiver.recordDiagnostic(this, "service_destroyed", 0, "");
            scheduleRestart(this, 5_000L);
        }
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) {
        return null;
    }

    private android.app.Notification notification() {
        Intent launch = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("semesterschedule://notification"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, flags);
        return new NotificationCompat.Builder(this, ReminderSupportPlugin.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("可靠提醒服务正在运行")
            .setContentText("日程与健康提醒已由安卓系统守护")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setSilent(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(content)
            .build();
    }

    private static void markHeartbeat(Context context) {
        prefs(context).edit().putLong(LAST_HEARTBEAT, System.currentTimeMillis()).apply();
    }

    private static void scheduleRestart(Context context, long delayMs) {
        try {
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (manager == null) return;
            PendingIntent pending = restartIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
            long triggerAt = System.currentTimeMillis() + Math.max(2_000L, delayMs);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            } else {
                manager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            }
        } catch (Exception error) {
            ReminderAlarmReceiver.recordDiagnostic(context, "service_restart_error", 0, error.getClass().getSimpleName());
        }
    }

    private static void cancelRestart(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = restartIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (manager != null && pending != null) manager.cancel(pending);
        if (pending != null) pending.cancel();
    }

    private static PendingIntent restartIntent(Context context, int baseFlags) {
        Intent intent = new Intent(context, ReliableReminderService.class).setAction(ACTION_RESTART);
        int flags = baseFlags;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(context, RESTART_REQUEST_ID, intent, flags);
        }
        return PendingIntent.getService(context, RESTART_REQUEST_ID, intent, flags);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
