package io.github.shalloweryin.semesterschedule;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Notification-free reminder watchdog. Actual reminder delivery is owned by persisted exact alarms;
 * this lightweight heartbeat verifies that Android can still wake the application without keeping
 * a foreground service notification in the user's notification shade.
 *
 * The class name is retained so upgrades keep the existing preferences and bridge contract.
 */
public final class ReliableReminderService {
    private static final String LEGACY_SERVICE_CHANNEL_ID = "reminder-service-v1";
    private static final String PREFS = "reliable_reminder_service_v1";
    private static final String ENABLED = "enabled";
    private static final String LAST_HEARTBEAT = "lastHeartbeatAt";
    private static final String START_COUNT = "startCount";
    private static final String ACTION_HEARTBEAT = "io.github.shalloweryin.semesterschedule.RELIABLE_REMINDER_HEARTBEAT";
    private static final int LEGACY_NOTIFICATION_ID = 31_010;
    private static final int HEARTBEAT_REQUEST_ID = 31_011;
    private static final long HEARTBEAT_MS = 15 * 60_000L;

    private ReliableReminderService() {}

    public static void start(Context context) {
        SharedPreferences state = prefs(context);
        state.edit()
            .putBoolean(ENABLED, true)
            .putInt(START_COUNT, state.getInt(START_COUNT, 0) + 1)
            .apply();
        removeLegacyForegroundNotification(context);
        markHeartbeat(context);
        scheduleHeartbeat(context, HEARTBEAT_MS);
        ReminderAlarmReceiver.recordDiagnostic(context, "service_started", 0, String.valueOf(startCount(context)));
    }

    public static void stop(Context context) {
        prefs(context).edit().putBoolean(ENABLED, false).apply();
        cancelHeartbeat(context);
        removeLegacyForegroundNotification(context);
        ReminderAlarmReceiver.recordDiagnostic(context, "service_stopped", 0, "");
    }

    public static void restoreIfEnabled(Context context) {
        removeLegacyForegroundNotification(context);
        if (isEnabled(context)) scheduleHeartbeat(context, 10_000L);
    }

    public static void onHeartbeat(Context context) {
        if (!isEnabled(context)) {
            cancelHeartbeat(context);
            return;
        }
        markHeartbeat(context);
        scheduleHeartbeat(context, HEARTBEAT_MS);
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(ENABLED, false);
    }

    public static boolean isRunning(Context context) {
        return isEnabled(context) && heartbeatIntent(context, PendingIntent.FLAG_NO_CREATE) != null;
    }

    public static long lastHeartbeatAt(Context context) {
        return prefs(context).getLong(LAST_HEARTBEAT, 0L);
    }

    public static int startCount(Context context) {
        return prefs(context).getInt(START_COUNT, 0);
    }

    private static void markHeartbeat(Context context) {
        prefs(context).edit().putLong(LAST_HEARTBEAT, System.currentTimeMillis()).apply();
    }

    private static void scheduleHeartbeat(Context context, long delayMs) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent pending = heartbeatIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
        long triggerAt = System.currentTimeMillis() + Math.max(5_000L, delayMs);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            } else {
                manager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            }
        } catch (SecurityException denied) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            } else {
                manager.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            }
            ReminderAlarmReceiver.recordDiagnostic(context, "service_heartbeat_inexact", 0, denied.getClass().getSimpleName());
        }
    }

    private static void cancelHeartbeat(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = heartbeatIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (manager != null && pending != null) manager.cancel(pending);
        if (pending != null) pending.cancel();
    }

    private static PendingIntent heartbeatIntent(Context context, int baseFlags) {
        Intent intent = new Intent(context, ReliableReminderReceiver.class).setAction(ACTION_HEARTBEAT);
        int flags = baseFlags;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, HEARTBEAT_REQUEST_ID, intent, flags);
    }

    private static void removeLegacyForegroundNotification(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.cancel(LEGACY_NOTIFICATION_ID);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.deleteNotificationChannel(LEGACY_SERVICE_CHANNEL_ID);
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
