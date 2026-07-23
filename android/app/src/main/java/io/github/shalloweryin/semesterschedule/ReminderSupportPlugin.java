package io.github.shalloweryin.semesterschedule;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** Native exact-alarm scheduler plus durable diagnostics for Android reminders. */
@CapacitorPlugin(name = "ReminderSupport")
public class ReminderSupportPlugin extends Plugin {
    public static final String CHANNEL_ID = "reminders-v3";

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "日程提醒（响铃与振动）",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("事项、纪念日与活动的系统提醒");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.enableLights(true);
        channel.setLightColor(0xff3157d5);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 320, 180, 320 });
        Uri sound = Settings.System.DEFAULT_NOTIFICATION_URI;
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(sound, attributes);
        manager.createNotificationChannel(channel);
    }

    @PluginMethod
    public void ensureChannel(PluginCall call) {
        ensureChannel(getContext());
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void getSystemStatus(PluginCall call) {
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void scheduleReminders(PluginCall call) {
        ensureChannel(getContext());
        JSArray reminders = call.getArray("reminders", new JSArray());
        try {
            ReminderAlarmReceiver.reconcile(getContext(), reminders);
            JSObject result = systemStatus();
            result.put("scheduledCount", ReminderAlarmReceiver.scheduledCount(getContext()));
            call.resolve(result);
        } catch (Exception error) {
            ReminderAlarmReceiver.recordDiagnostic(getContext(), "schedule_error", 0, error.getClass().getSimpleName());
            call.reject("原生提醒注册失败", error);
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        ReminderAlarmReceiver.cancelAll(getContext());
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void postNow(PluginCall call) {
        ensureChannel(getContext());
        int id = call.getInt("id", 2_147_483_646);
        String title = call.getString("title", "提醒测试");
        String body = call.getString("body", "如果看到并感受到振动，说明通知渠道可用。");
        String key = call.getString("key", "test:immediate");
        ReminderAlarmReceiver.postNotification(getContext(), id, title, body, key);
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void scheduleTest(PluginCall call) {
        ensureChannel(getContext());
        int delaySeconds = Math.max(30, call.getInt("delaySeconds", 120));
        long triggerAt = System.currentTimeMillis() + delaySeconds * 1000L;
        int id = call.getInt("id", 2_147_483_646);
        JSONObject record = ReminderAlarmReceiver.createRecord(
            id,
            "后台提醒测试",
            "这是由安卓系统在应用退出或熄屏后触发的测试提醒。",
            "test:scheduled",
            "test:" + triggerAt,
            triggerAt
        );
        try {
            ReminderAlarmReceiver.upsertAndSchedule(getContext(), record);
            JSObject result = systemStatus();
            result.put("triggerAt", triggerAt);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("测试提醒注册失败", error);
        }
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject result = systemStatus();
        result.put("scheduledCount", ReminderAlarmReceiver.scheduledCount(getContext()));
        result.put("nextTriggerAt", ReminderAlarmReceiver.nextTriggerAt(getContext()));
        result.put("lastReceivedAt", ReminderAlarmReceiver.lastStageAt(getContext(), "received"));
        result.put("lastNotifiedAt", ReminderAlarmReceiver.lastStageAt(getContext(), "notified"));
        result.put("events", ReminderAlarmReceiver.diagnostics(getContext()));
        call.resolve(result);
    }

    private JSObject systemStatus() {
        Context context = getContext();
        boolean exactAlarmAllowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            exactAlarmAllowed = alarms != null && alarms.canScheduleExactAlarms();
        }

        boolean batteryOptimizationIgnored = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            batteryOptimizationIgnored = power != null && power.isIgnoringBatteryOptimizations(context.getPackageName());
        }

        int importance = NotificationManager.IMPORTANCE_HIGH;
        boolean soundEnabled = true;
        boolean vibrationEnabled = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = manager != null ? manager.getNotificationChannel(CHANNEL_ID) : null;
            importance = channel != null ? channel.getImportance() : NotificationManager.IMPORTANCE_NONE;
            soundEnabled = channel != null && channel.getSound() != null;
            vibrationEnabled = channel != null && channel.shouldVibrate();
        }

        JSObject result = new JSObject();
        result.put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled());
        result.put("exactAlarmAllowed", exactAlarmAllowed);
        result.put("batteryOptimizationIgnored", batteryOptimizationIgnored);
        result.put("channelImportance", importance);
        result.put("channelSoundEnabled", soundEnabled);
        result.put("channelVibrationEnabled", vibrationEnabled);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("scheduledCount", ReminderAlarmReceiver.scheduledCount(context));
        result.put("nextTriggerAt", ReminderAlarmReceiver.nextTriggerAt(context));
        return result;
    }
}
