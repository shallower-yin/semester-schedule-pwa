package io.github.shalloweryin.semesterschedule;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Receives exact alarms without requiring the Capacitor WebView process to be alive. */
public class ReminderAlarmReceiver extends BroadcastReceiver {
    private static final String PREFS = "native_reminder_store_v3";
    private static final String RECORDS = "records";
    private static final String EVENTS = "events";
    private static final String ACTION_FIRE = "io.github.shalloweryin.semesterschedule.REMINDER_FIRE";
    private static final int MAX_DIAGNOSTICS = 80;

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", 0);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String key = intent.getStringExtra("key");
        JSONObject record = findRecord(context, id);
        recordDiagnostic(context, "received", id, key == null ? "" : key);
        removeRecord(context, id);
        postNotification(context, id, title, body, key);
        if (record != null && record.optInt("repeatIntervalMinutes") > 0) {
            try {
                long nextTrigger = nextWindowedTrigger(
                    Math.max(System.currentTimeMillis(), record.optLong("triggerAt")),
                    record.optInt("repeatIntervalMinutes"),
                    record.optInt("windowStartMinutes"),
                    record.optInt("windowEndMinutes")
                );
                record.put("triggerAt", nextTrigger);
                record.put("sig", "health:" + nextTrigger);
                upsertAndSchedule(context, record);
            } catch (Exception error) {
                recordDiagnostic(context, "health_repeat_error", id, error.getClass().getSimpleName());
            }
        }
    }

    public static JSONObject createRecord(int id, String title, String body, String key, String sig, long triggerAt) {
        JSONObject record = new JSONObject();
        try {
            record.put("id", id);
            record.put("title", title == null ? "日程提醒" : title);
            record.put("body", body == null ? "你有一条日程提醒" : body);
            record.put("key", key == null ? "" : key);
            record.put("sig", sig == null ? "" : sig);
            record.put("triggerAt", triggerAt);
        } catch (Exception ignored) {
            // Values above are primitive and safe for JSONObject.
        }
        return record;
    }

    public static synchronized void reconcile(Context context, JSArray desired) throws Exception {
        JSONArray current = readRecords(context);
        Set<Integer> desiredIds = new HashSet<>();
        JSONArray next = new JSONArray();
        for (int index = 0; index < desired.length(); index += 1) {
            JSONObject item = desired.getJSONObject(index);
            int id = item.getInt("id");
            long triggerAt = item.getLong("triggerAt");
            if (triggerAt <= System.currentTimeMillis()) continue;
            JSONObject record = createRecord(
                id,
                item.optString("title", "日程提醒"),
                item.optString("body", "你有一条日程提醒"),
                item.optString("key", ""),
                item.optString("sig", ""),
                triggerAt
            );
            desiredIds.add(id);
            next.put(record);
        }
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject item = current.optJSONObject(index);
            if (item == null) continue;
            int id = item.optInt("id");
            String key = item.optString("key", "");
            if ((key.startsWith("test:") || key.startsWith("health"))
                && item.optLong("triggerAt") > System.currentTimeMillis()
                && !desiredIds.contains(id)) {
                desiredIds.add(id);
                next.put(item);
            }
        }
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && !desiredIds.contains(item.optInt("id"))) cancelAlarm(context, item.optInt("id"));
        }
        writeRecords(context, next);
        for (int index = 0; index < next.length(); index += 1) schedule(context, next.getJSONObject(index));
    }

    public static synchronized void upsertAndSchedule(Context context, JSONObject record) throws Exception {
        JSONArray current = readRecords(context);
        JSONArray next = new JSONArray();
        int id = record.getInt("id");
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && item.optInt("id") != id) next.put(item);
        }
        next.put(record);
        writeRecords(context, next);
        schedule(context, record);
    }

    public static synchronized void restore(Context context) {
        JSONArray current = readRecords(context);
        JSONArray future = new JSONArray();
        long now = System.currentTimeMillis();
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject record = current.optJSONObject(index);
            if (record == null) continue;
            long triggerAt = record.optLong("triggerAt");
            try {
                if (triggerAt > now) {
                    future.put(record);
                    schedule(context, record);
                } else if (now - triggerAt <= 15 * 60_000L) {
                    record.put("triggerAt", now + 5_000L);
                    future.put(record);
                    schedule(context, record);
                }
            } catch (Exception error) {
                recordDiagnostic(context, "restore_error", record.optInt("id"), error.getClass().getSimpleName());
            }
        }
        writeRecords(context, future);
        recordDiagnostic(context, "restored", 0, String.valueOf(future.length()));
    }

    private static void schedule(Context context, JSONObject record) throws Exception {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) throw new IllegalStateException("AlarmManager unavailable");
        int id = record.getInt("id");
        long triggerAt = record.getLong("triggerAt");
        PendingIntent pending = alarmIntent(context, record, PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
        } else {
            manager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pending);
        }
        recordDiagnostic(context, "scheduled", id, String.valueOf(triggerAt));
    }

    private static PendingIntent alarmIntent(Context context, JSONObject record, int baseFlags) {
        Intent intent = new Intent(context, ReminderAlarmReceiver.class);
        intent.setAction(ACTION_FIRE);
        int id = record.optInt("id");
        intent.putExtra("id", id);
        intent.putExtra("title", record.optString("title", "日程提醒"));
        intent.putExtra("body", record.optString("body", "你有一条日程提醒"));
        intent.putExtra("key", record.optString("key", ""));
        int flags = baseFlags;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, id, intent, flags);
    }

    private static void cancelAlarm(Context context, int id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONObject record = createRecord(id, "", "", "", "", 0);
        PendingIntent pending = alarmIntent(context, record, PendingIntent.FLAG_NO_CREATE);
        if (manager != null && pending != null) manager.cancel(pending);
        if (pending != null) pending.cancel();
    }

    public static synchronized void cancelAll(Context context) {
        JSONArray current = readRecords(context);
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject record = current.optJSONObject(index);
            if (record != null) cancelAlarm(context, record.optInt("id"));
        }
        writeRecords(context, new JSONArray());
        recordDiagnostic(context, "cancelled_all", 0, String.valueOf(current.length()));
    }

    public static synchronized void cancelById(Context context, int id) {
        if (findRecord(context, id) == null) return;
        cancelAlarm(context, id);
        removeRecord(context, id);
        recordDiagnostic(context, "cancelled", id, "");
    }

    private static synchronized void removeRecord(Context context, int id) {
        JSONArray current = readRecords(context);
        JSONArray next = new JSONArray();
        for (int index = 0; index < current.length(); index += 1) {
            JSONObject record = current.optJSONObject(index);
            if (record != null && record.optInt("id") != id) next.put(record);
        }
        writeRecords(context, next);
    }

    public static void postNotification(Context context, int id, String title, String body, String key) {
        ReminderSupportPlugin.ensureChannel(context);
        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(Intent.ACTION_VIEW);
        launch.setData(Uri.parse("semesterschedule://notification?key=" + Uri.encode(key == null ? "" : key)));
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(context, id, launch, flags);

        Notification publicVersion = new NotificationCompat.Builder(context, ReminderSupportPlugin.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("日程提醒")
            .setContentText("你有一条日程提醒")
            .build();
        Notification notification = new NotificationCompat.Builder(context, ReminderSupportPlugin.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "日程提醒" : title)
            .setContentText(body == null || body.isEmpty() ? "你有一条日程提醒" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setLights(0xff3157d5, 700, 1800)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build();
        try {
            NotificationManagerCompat.from(context).notify(id, notification);
            recordDiagnostic(context, "notified", id, key == null ? "" : key);
        } catch (SecurityException error) {
            recordDiagnostic(context, "notify_denied", id, error.getClass().getSimpleName());
        }
    }

    public static synchronized int scheduledCount(Context context) {
        return readRecords(context).length();
    }

    public static synchronized long nextTriggerAt(Context context) {
        JSONArray records = readRecords(context);
        long next = 0;
        for (int index = 0; index < records.length(); index += 1) {
            JSONObject record = records.optJSONObject(index);
            if (record == null) continue;
            long at = record.optLong("triggerAt");
            if (at > 0 && (next == 0 || at < next)) next = at;
        }
        return next;
    }

    public static synchronized void recordDiagnostic(Context context, String stage, int id, String detail) {
        JSONArray current = diagnostics(context);
        JSONArray next = new JSONArray();
        JSONObject event = new JSONObject();
        try {
            event.put("at", System.currentTimeMillis());
            event.put("stage", stage);
            event.put("id", id);
            event.put("detail", detail == null ? "" : detail);
            next.put(event);
            int keep = Math.min(current.length(), MAX_DIAGNOSTICS - 1);
            for (int index = 0; index < keep; index += 1) next.put(current.opt(index));
        } catch (Exception ignored) {
            // Diagnostic logging must never prevent a reminder.
        }
        prefs(context).edit().putString(EVENTS, next.toString()).apply();
    }

    public static synchronized JSArray diagnostics(Context context) {
        try {
            return new JSArray(prefs(context).getString(EVENTS, "[]"));
        } catch (Exception ignored) {
            return new JSArray();
        }
    }

    public static synchronized long lastStageAt(Context context, String stage) {
        JSArray events = diagnostics(context);
        for (int index = 0; index < events.length(); index += 1) {
            JSONObject event = events.optJSONObject(index);
            if (event != null && stage.equals(event.optString("stage"))) return event.optLong("at");
        }
        return 0;
    }

    private static JSONArray readRecords(Context context) {
        try {
            return new JSONArray(prefs(context).getString(RECORDS, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static JSONObject findRecord(Context context, int id) {
        JSONArray records = readRecords(context);
        for (int index = 0; index < records.length(); index += 1) {
            JSONObject record = records.optJSONObject(index);
            if (record != null && record.optInt("id") == id) return record;
        }
        return null;
    }

    private static long nextWindowedTrigger(long from, int intervalMinutes, int startMinutes, int endMinutes) {
        java.util.Calendar next = java.util.Calendar.getInstance();
        next.setTimeInMillis(from);
        next.add(java.util.Calendar.MINUTE, Math.max(15, intervalMinutes));
        int minute = next.get(java.util.Calendar.HOUR_OF_DAY) * 60 + next.get(java.util.Calendar.MINUTE);
        boolean inside = startMinutes <= endMinutes
            ? minute >= startMinutes && minute <= endMinutes
            : minute >= startMinutes || minute <= endMinutes;
        if (inside) return next.getTimeInMillis();

        if (startMinutes <= endMinutes && minute > endMinutes) {
            next.add(java.util.Calendar.DAY_OF_MONTH, 1);
        }
        next.set(java.util.Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, startMinutes / 60)));
        next.set(java.util.Calendar.MINUTE, Math.max(0, Math.min(59, startMinutes % 60)));
        next.set(java.util.Calendar.SECOND, 0);
        next.set(java.util.Calendar.MILLISECOND, 0);
        return next.getTimeInMillis();
    }

    private static void writeRecords(Context context, JSONArray records) {
        prefs(context).edit().putString(RECORDS, records.toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
