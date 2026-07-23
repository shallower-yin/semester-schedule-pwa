package io.github.shalloweryin.semesterschedule;

import android.app.AlarmManager;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** Native exact-alarm scheduler plus durable diagnostics for Android reminders. */
@CapacitorPlugin(name = "ReminderSupport")
public class ReminderSupportPlugin extends Plugin {
    public static final String CHANNEL_ID = "reminders-v4";
    public static final int HEALTH_NOTIFICATION_ID = 2_147_483_645;

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        // Android keeps channels across updates. Remove only channels created by older releases and
        // Capacitor's unused default channel; the focus foreground-service channel remains intact.
        manager.deleteNotificationChannel("reminders");
        manager.deleteNotificationChannel("reminders-v2");
        manager.deleteNotificationChannel("reminders-v3");
        manager.deleteNotificationChannel("default");
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "重要日程提醒",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("事项、纪念日与健康活动的高优先级静音提醒");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.enableLights(true);
        channel.setLightColor(0xff3157d5);
        channel.enableVibration(false);
        channel.setVibrationPattern(null);
        channel.setSound(null, null);
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
    public void scheduleHealthReminder(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (!enabled) {
            ReminderAlarmReceiver.cancelById(getContext(), HEALTH_NOTIFICATION_ID);
            call.resolve(systemStatus());
            return;
        }
        long triggerAt = call.getLong("triggerAt", 0L);
        int intervalMinutes = Math.max(15, call.getInt("intervalMinutes", 60));
        int startMinutes = Math.max(0, Math.min(1439, call.getInt("startMinutes", 9 * 60)));
        int endMinutes = Math.max(0, Math.min(1439, call.getInt("endMinutes", 22 * 60)));
        if (triggerAt <= System.currentTimeMillis()) triggerAt = System.currentTimeMillis() + 5_000L;
        JSONObject record = ReminderAlarmReceiver.createRecord(
            HEALTH_NOTIFICATION_ID,
            "起来活动一下",
            "喝口水，活动肩颈或走动几分钟。完成后可在健康页记录。",
            "health",
            "health:" + triggerAt,
            triggerAt
        );
        try {
            record.put("repeatIntervalMinutes", intervalMinutes);
            record.put("windowStartMinutes", startMinutes);
            record.put("windowEndMinutes", endMinutes);
            ReminderAlarmReceiver.upsertAndSchedule(getContext(), record);
            call.resolve(systemStatus());
        } catch (Exception error) {
            ReminderAlarmReceiver.recordDiagnostic(getContext(), "health_schedule_error", HEALTH_NOTIFICATION_ID, error.getClass().getSimpleName());
            call.reject("健康活动提醒注册失败", error);
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

    @PluginMethod
    public void startReliableService(PluginCall call) {
        try {
            ReliableReminderService.start(getContext());
            call.resolve(systemStatus());
        } catch (Exception error) {
            ReminderAlarmReceiver.recordDiagnostic(getContext(), "service_start_error", 0, error.getClass().getSimpleName());
            call.reject("可靠提醒服务启动失败", error);
        }
    }

    @PluginMethod
    public void stopReliableService(PluginCall call) {
        ReliableReminderService.stop(getContext());
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        intent.putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve(systemStatus());
            return;
        }
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
            call.resolve(systemStatus());
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "batteryExemptionResult");
    }

    @ActivityCallback
    private void batteryExemptionResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(systemStatus());
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
        result.put("lastExitReason", lastExitReason(context));
        result.put("scheduledCount", ReminderAlarmReceiver.scheduledCount(context));
        result.put("nextTriggerAt", ReminderAlarmReceiver.nextTriggerAt(context));
        result.put("reliableServiceEnabled", ReliableReminderService.isEnabled(context));
        result.put("reliableServiceRunning", ReliableReminderService.isRunning(context));
        result.put("reliableServiceLastHeartbeatAt", ReliableReminderService.lastHeartbeatAt(context));
        result.put("reliableServiceStartCount", ReliableReminderService.startCount(context));
        return result;
    }

    private String lastExitReason(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "";
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return "";
        try {
            java.util.List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 1);
            if (exits.isEmpty()) return "";
            ApplicationExitInfo info = exits.get(0);
            return info.getReason() + ":" + info.getDescription();
        } catch (Exception ignored) {
            return "";
        }
    }
}
