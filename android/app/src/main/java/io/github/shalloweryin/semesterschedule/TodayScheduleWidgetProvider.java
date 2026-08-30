package io.github.shalloweryin.semesterschedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Renders the persisted schedule snapshot without starting the WebView. */
public class TodayScheduleWidgetProvider extends AppWidgetProvider {
    private static final TimeZone SHANGHAI = TimeZone.getTimeZone("Asia/Shanghai");
    private static final String DATE_FORMAT = "yyyy-MM-dd";
    private static final int MAX_ROWS = 5;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_DATE_CHANGED.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            updateAll(context);
        }
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, TodayScheduleWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        for (int id : ids) update(context, manager, id);
    }

    private static void update(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_schedule);
        JSONObject snapshot = ScheduleWidgetStore.read(context);
        views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_today_title));
        views.setTextViewText(R.id.widget_date, todayLabel());
        views.setTextViewText(R.id.widget_updated, updatedLabel(snapshot));
        setOpenIntent(context, views, R.id.widget_root, "route:today", 1000 + id);
        setOpenIntent(context, views, R.id.widget_quick_entry, "route:quick-entry", 2000 + id);

        JSONArray items = findTodayItems(snapshot);
        boolean hasToday = items != null;
        int count = items != null ? Math.min(items.length(), MAX_ROWS) : 0;
        int[] rowIds = {R.id.widget_item_1, R.id.widget_item_2, R.id.widget_item_3, R.id.widget_item_4, R.id.widget_item_5};
        for (int i = 0; i < rowIds.length; i++) {
            if (i < count) {
                JSONObject item = items.optJSONObject(i);
                views.setViewVisibility(rowIds[i], android.view.View.VISIBLE);
                views.setTextViewText(rowIds[i], formatItem(item));
                String key = item != null ? item.optString("key", "") : "";
                String route = key.isEmpty() ? "route:today" : key;
                setOpenIntent(context, views, rowIds[i], route, 3000 + id * 10 + i);
            } else {
                views.setViewVisibility(rowIds[i], android.view.View.GONE);
            }
        }
        views.setViewVisibility(R.id.widget_empty, count == 0 ? android.view.View.VISIBLE : android.view.View.GONE);
        if (!hasToday) views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_refresh));
        else views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty));
        manager.updateAppWidget(id, views);
    }

    private static JSONArray findTodayItems(JSONObject snapshot) {
        if (snapshot == null) return null;
        SimpleDateFormat dateFormat = new SimpleDateFormat(DATE_FORMAT, Locale.US);
        dateFormat.setTimeZone(SHANGHAI);
        String today = dateFormat.format(new Date());
        JSONArray days = snapshot.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject day = days.optJSONObject(i);
            if (day != null && today.equals(day.optString("date"))) return day.optJSONArray("items");
        }
        return null;
    }

    private static String formatItem(JSONObject item) {
        if (item == null) return "";
        String title = item.optString("title", "未命名日程").trim();
        if (title.codePointCount(0, title.length()) > 48) {
            title = title.substring(0, title.offsetByCodePoints(0, 47)) + "…";
        }
        String time = formatTime(item);
        return time.isEmpty() ? title : time + "  " + title;
    }

    private static String formatTime(JSONObject item) {
        if (item.optBoolean("allDay", false)) return "全天";
        int start = item.optInt("startMinute", -1), end = item.optInt("endMinute", -1);
        if (start < 0) return "";
        String result = String.format(Locale.CHINA, "%02d:%02d", start / 60, start % 60);
        if (end >= 0) result += "-" + String.format(Locale.CHINA, "%02d:%02d", end / 60, end % 60);
        return result;
    }

    private static String todayLabel() {
        Calendar calendar = Calendar.getInstance(SHANGHAI, Locale.CHINA);
        String[] weekdays = {"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"};
        return String.format(Locale.CHINA, "%d月%d日 %s", calendar.get(Calendar.MONTH) + 1,
            calendar.get(Calendar.DAY_OF_MONTH), weekdays[calendar.get(Calendar.DAY_OF_WEEK) - 1]);
    }

    private static String updatedLabel(JSONObject snapshot) {
        if (snapshot == null) return "等待应用同步";
        String generatedAt = snapshot.optString("generatedAt", "");
        if (generatedAt.length() < 16) return "已更新";
        try {
            String prefix = generatedAt.substring(0, Math.min(19, generatedAt.length()));
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            parser.setLenient(false);
            parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date parsed = parser.parse(prefix);
            if (parsed == null) return "已更新";
            SimpleDateFormat formatter = new SimpleDateFormat("HH:mm", Locale.CHINA);
            formatter.setTimeZone(SHANGHAI);
            return "更新于 " + formatter.format(parsed);
        } catch (Exception ignored) {
            return "已更新";
        }
    }

    private static void setOpenIntent(Context context, RemoteViews views, int viewId, String key, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("semesterschedule://notification?key=" + Uri.encode(key)));
        intent.setPackage(context.getPackageName());
        PendingIntent pending = PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(viewId, pending);
    }
}
