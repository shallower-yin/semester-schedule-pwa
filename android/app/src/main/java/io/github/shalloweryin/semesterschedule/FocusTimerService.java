package io.github.shalloweryin.semesterschedule;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/** Foreground Pomodoro state machine that continues across app switches and screen-off. */
public class FocusTimerService extends Service {
    private static final String CHANNEL_ID = "focus-overlay-v1";
    private static final String ALERT_CHANNEL_ID = "focus-alerts-v1";
    private static final int NOTIFICATION_ID = 31_002;
    private static final int ALERT_NOTIFICATION_ID = 31_003;
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (!tick()) return;
            HANDLER.postDelayed(this, 1000);
        }
    };

    static void start(Context context) {
        Intent intent = new Intent(context, FocusTimerService.class);
        ContextCompat.startForegroundService(context, intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, FocusTimerService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        ensureChannel();
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":pomodoro");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, notification());
        HANDLER.removeCallbacks(ticker);
        HANDLER.post(ticker);
        return START_STICKY;
    }

    @Override public void onDestroy() {
        HANDLER.removeCallbacks(ticker);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean tick() {
        SharedPreferences prefs = getSharedPreferences(FocusNativeTimerPlugin.PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean(FocusNativeTimerPlugin.ACTIVE, false)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return false;
        }
        long planned = prefs.getLong(FocusNativeTimerPlugin.PLANNED, -1);
        long elapsed = FocusNativeTimerPlugin.readElapsedSeconds(this, prefs);
        if (planned > 0 && elapsed >= planned && !prefs.getBoolean(FocusNativeTimerPlugin.PAUSED, false)) {
            transition(prefs, planned);
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null && prefs.getBoolean(FocusNativeTimerPlugin.ACTIVE, false)) {
            manager.notify(NOTIFICATION_ID, notification());
        }
        return prefs.getBoolean(FocusNativeTimerPlugin.ACTIVE, false);
    }

    private synchronized void transition(SharedPreferences prefs, long planned) {
        long endedAt = System.currentTimeMillis();
        String mode = prefs.getString(FocusNativeTimerPlugin.MODE, "pomodoro");
        String planId = prefs.getString(FocusNativeTimerPlugin.PLAN_ID, "");
        int round = prefs.getInt(FocusNativeTimerPlugin.ROUND, 1);
        if (planId.isEmpty()) return;

        appendTransition(prefs, mode, planned, endedAt);
        if ("pomodoro".equals(mode) && prefs.getBoolean(FocusNativeTimerPlugin.AUTO_BREAK, true)) {
            int total = Math.max(round, prefs.getInt(FocusNativeTimerPlugin.TOTAL_ROUNDS, round));
            int interval = Math.max(1, prefs.getInt(FocusNativeTimerPlugin.LONG_INTERVAL, 4));
            boolean isLong = round % interval == 0 || round >= total;
            long breakSeconds = prefs.getLong(isLong ? FocusNativeTimerPlugin.LONG_BREAK : FocusNativeTimerPlugin.SHORT_BREAK, isLong ? 900 : 300);
            prefs.edit()
                .putBoolean(FocusNativeTimerPlugin.ACTIVE, true)
                .putString(FocusNativeTimerPlugin.MODE, "rest")
                .putString(FocusNativeTimerPlugin.TITLE, isLong ? "长休息" : "短休息")
                .putString(FocusNativeTimerPlugin.REST_KIND, isLong ? "pomodoro_long" : "pomodoro_short")
                .putLong(FocusNativeTimerPlugin.PLANNED, breakSeconds)
                .putLong(FocusNativeTimerPlugin.ELAPSED_BASE, 0)
                .putLong(FocusNativeTimerPlugin.ANCHOR_REALTIME, SystemClock.elapsedRealtime())
                .putLong(FocusNativeTimerPlugin.ANCHOR_WALL, endedAt)
                .putLong(FocusNativeTimerPlugin.ANCHOR_BOOT, FocusNativeTimerPlugin.bootCount(this))
                .putBoolean(FocusNativeTimerPlugin.PAUSED, false)
                .apply();
            alert("专注完成，已自动开始" + (isLong ? "长休息" : "短休息"));
        } else {
            prefs.edit().putBoolean(FocusNativeTimerPlugin.ACTIVE, false).apply();
            alert("rest".equals(mode) ? "休息结束，可以开始下一轮专注" : "专注结束");
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void appendTransition(SharedPreferences prefs, String mode, long duration, long endedAt) {
        synchronized (FocusNativeTimerPlugin.TRANSITION_LOCK) {
            try {
                JSONArray transitions = new JSONArray(prefs.getString(FocusNativeTimerPlugin.TRANSITIONS, "[]"));
                JSONObject event = new JSONObject();
                event.put("id", UUID.randomUUID().toString());
                event.put("ownerId", prefs.getString(FocusNativeTimerPlugin.OWNER, ""));
                event.put("kind", "rest".equals(mode) ? "rest" : "focus");
                event.put("mode", mode);
                event.put("title", prefs.getString(FocusNativeTimerPlugin.TITLE, ""));
                event.put("linkedEventId", prefs.getString(FocusNativeTimerPlugin.LINKED_EVENT, ""));
                event.put("plannedSeconds", duration);
                event.put("durationSeconds", duration);
                event.put("startedAt", endedAt - duration * 1000L);
                event.put("endedAt", endedAt);
                event.put("pomodoroPlanId", prefs.getString(FocusNativeTimerPlugin.PLAN_ID, ""));
                event.put("pomodoroRound", prefs.getInt(FocusNativeTimerPlugin.ROUND, 1));
                event.put("pomodoroTotalRounds", prefs.getInt(FocusNativeTimerPlugin.TOTAL_ROUNDS, 1));
                event.put("restKind", prefs.getString(FocusNativeTimerPlugin.REST_KIND, "manual"));
                transitions.put(event);
                prefs.edit().putString(FocusNativeTimerPlugin.TRANSITIONS, transitions.toString()).apply();
            } catch (Exception ignored) {
                // The active timer remains authoritative even if a diagnostic record cannot be appended.
            }
        }
    }

    private Notification notification() {
        SharedPreferences prefs = getSharedPreferences(FocusNativeTimerPlugin.PREFS, MODE_PRIVATE);
        String mode = prefs.getString(FocusNativeTimerPlugin.MODE, "pomodoro");
        long planned = prefs.getLong(FocusNativeTimerPlugin.PLANNED, 0);
        long elapsed = FocusNativeTimerPlugin.readElapsedSeconds(this, prefs);
        long remaining = Math.max(0, planned - elapsed);
        int round = prefs.getInt(FocusNativeTimerPlugin.ROUND, 1);
        int total = prefs.getInt(FocusNativeTimerPlugin.TOTAL_ROUNDS, 1);
        Intent launch = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(android.net.Uri.parse("semesterschedule://focus"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("rest".equals(mode) ? prefs.getString(FocusNativeTimerPlugin.TITLE, "休息") : "番茄专注 " + round + "/" + total)
            .setContentText(format(remaining))
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(content)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "专注计时", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("番茄钟、锁机与悬浮计时的持续状态");
        manager.createNotificationChannel(channel);
        NotificationChannel alertChannel = new NotificationChannel(ALERT_CHANNEL_ID, "专注阶段提醒", NotificationManager.IMPORTANCE_HIGH);
        alertChannel.setDescription("番茄专注和休息阶段结束提醒");
        alertChannel.setSound(null, null);
        alertChannel.enableVibration(false);
        manager.createNotificationChannel(alertChannel);
    }

    private void alert(String message) {
        SharedPreferences prefs = getSharedPreferences(FocusNativeTimerPlugin.PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(FocusNativeTimerPlugin.SOUND, true)) {
            try {
                Ringtone ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
                if (ringtone != null) ringtone.play();
            } catch (Exception ignored) {}
            try {
                Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createOneShot(350, VibrationEffect.DEFAULT_AMPLITUDE));
                    else vibrator.vibrate(350);
                }
            } catch (Exception ignored) {}
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Intent launch = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(android.net.Uri.parse("semesterschedule://focus"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, ALERT_NOTIFICATION_ID, launch, flags);
        if (manager != null) manager.notify(ALERT_NOTIFICATION_ID, new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(message)
            .setContentText("点击返回专注页面")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(content)
            .build());
    }

    private String format(long seconds) {
        return String.format("%02d:%02d", seconds / 60, seconds % 60);
    }
}
