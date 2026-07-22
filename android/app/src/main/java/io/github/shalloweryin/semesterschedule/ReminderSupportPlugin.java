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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Creates and audits the reminder channel without relying on a bundled sound file. */
@CapacitorPlugin(name = "ReminderSupport")
public class ReminderSupportPlugin extends Plugin {
    public static final String CHANNEL_ID = "reminders-v2";

    @PluginMethod
    public void ensureChannel(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "日程提醒（重要）",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("事项、纪念日与活动的锁屏提醒");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
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
        call.resolve(systemStatus());
    }

    @PluginMethod
    public void getSystemStatus(PluginCall call) {
        call.resolve(systemStatus());
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
        return result;
    }
}
