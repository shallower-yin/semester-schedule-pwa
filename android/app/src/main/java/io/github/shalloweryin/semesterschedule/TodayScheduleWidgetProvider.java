package io.github.shalloweryin.semesterschedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Renders the persisted schedule and todo snapshot without starting the WebView. */
public class TodayScheduleWidgetProvider extends AppWidgetProvider {
    private static final TimeZone SHANGHAI = TimeZone.getTimeZone("Asia/Shanghai");
    private static final String DATE_FORMAT = "yyyy-MM-dd";
    private static final int COMPACT_ROWS = 2;
    private static final int EXPANDED_ROWS = 3;
    private static final int EXPANDED_HEIGHT_DP = 230;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override public void onAppWidgetOptionsChanged(
        Context context,
        AppWidgetManager manager,
        int appWidgetId,
        Bundle newOptions
    ) {
        super.onAppWidgetOptionsChanged(context, manager, appWidgetId, newOptions);
        update(context, manager, appWidgetId);
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
        int rowLimit = rowsForWidget(manager, id);

        views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_today_title));
        views.setTextViewText(R.id.widget_date, todayLabel());
        views.setTextViewText(R.id.widget_todo_title, context.getString(R.string.widget_todo_title));

        int scheduleRequestCode = 1000 + id;
        int todoRequestCode = 2000 + id;
        setOpenIntents(context, views, new int[] {
            R.id.widget_schedule_section, R.id.widget_schedule_header, R.id.widget_title,
            R.id.widget_date, R.id.widget_empty, R.id.widget_item_1,
            R.id.widget_item_2, R.id.widget_item_3
        }, "route:today", scheduleRequestCode);
        setOpenIntents(context, views, new int[] {
            R.id.widget_todo_section, R.id.widget_todo_header, R.id.widget_todo_title,
            R.id.widget_todo_empty, R.id.widget_todo_item_1,
            R.id.widget_todo_item_2, R.id.widget_todo_item_3
        }, "route:todos", todoRequestCode);
        setOpenIntent(context, views, R.id.widget_todo_add, "route:todos-create", 3000 + id);

        JSONArray scheduleItems = findTodayItems(snapshot);
        bindScheduleRows(context, views, scheduleItems, rowLimit);

        JSONArray todos = findTodos(snapshot);
        bindTodoRows(context, views, todos, rowLimit);

        manager.updateAppWidget(id, views);
    }

    private static void bindScheduleRows(Context context, RemoteViews views, JSONArray items, int rowLimit) {
        int[] rowIds = {R.id.widget_item_1, R.id.widget_item_2, R.id.widget_item_3};
        int count = items == null ? 0 : Math.min(items.length(), rowLimit);
        for (int i = 0; i < rowIds.length; i++) {
            boolean visible = i < count;
            views.setViewVisibility(rowIds[i], visible ? View.VISIBLE : View.GONE);
            if (visible) views.setTextViewText(rowIds[i], formatScheduleItem(items.optJSONObject(i)));
        }
        views.setViewVisibility(R.id.widget_empty, count == 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_empty, context.getString(
            items == null ? R.string.widget_empty_refresh : R.string.widget_empty
        ));
    }

    private static void bindTodoRows(Context context, RemoteViews views, JSONArray todos, int rowLimit) {
        int[] rowIds = {R.id.widget_todo_item_1, R.id.widget_todo_item_2, R.id.widget_todo_item_3};
        int count = todos == null ? 0 : Math.min(todos.length(), rowLimit);
        for (int i = 0; i < rowIds.length; i++) {
            boolean visible = i < count;
            views.setViewVisibility(rowIds[i], visible ? View.VISIBLE : View.GONE);
            if (visible) views.setTextViewText(rowIds[i], formatTodo(todos.optJSONObject(i)));
        }
        views.setViewVisibility(R.id.widget_todo_empty, count == 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_todo_empty, context.getString(
            todos == null ? R.string.widget_todo_empty_refresh : R.string.widget_todo_empty
        ));
    }

    private static int rowsForWidget(AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        int minHeight = options != null
            ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            : 0;
        return rowsForHeight(minHeight);
    }

    static int rowsForHeight(int minHeight) {
        return minHeight >= EXPANDED_HEIGHT_DP ? EXPANDED_ROWS : COMPACT_ROWS;
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

    private static JSONArray findTodos(JSONObject snapshot) {
        if (snapshot == null || !snapshot.has("todos")) return null;
        return snapshot.optJSONArray("todos");
    }

    private static String formatScheduleItem(JSONObject item) {
        if (item == null) return "";
        String title = truncate(item.optString("title", "未命名日程"), 48, "未命名日程");
        String time = formatTime(item);
        return time.isEmpty() ? title : time + "  " + title;
    }

    private static String formatTodo(JSONObject item) {
        if (item == null) return "";
        return "○  " + truncate(item.optString("title", "未命名待办"), 64, "未命名待办");
    }

    static String truncate(String value, int maxCodePoints, String fallback) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) return fallback;
        if (text.codePointCount(0, text.length()) <= maxCodePoints) return text;
        return text.substring(0, text.offsetByCodePoints(0, maxCodePoints - 1)) + "…";
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

    private static void setOpenIntents(
        Context context,
        RemoteViews views,
        int[] viewIds,
        String key,
        int requestCode
    ) {
        for (int viewId : viewIds) setOpenIntent(context, views, viewId, key, requestCode);
    }

    private static void setOpenIntent(Context context, RemoteViews views, int viewId, String key, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("semesterschedule://notification?key=" + Uri.encode(key)));
        intent.setPackage(context.getPackageName());
        PendingIntent pending = PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(viewId, pending);
    }
}
