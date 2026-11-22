package io.github.shalloweryin.semesterschedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Renders the persisted schedule and todo snapshot without starting the WebView. */
public class TodayScheduleWidgetProvider extends AppWidgetProvider {
    static final String ACTION_COMPLETE_ITEM = "io.github.shalloweryin.semesterschedule.action.COMPLETE_WIDGET_ITEM";
    static final String ACTION_WIDGET_ITEM = "io.github.shalloweryin.semesterschedule.action.WIDGET_ITEM";
    private static final String EXTRA_OWNER = "widget_owner_digest";
    private static final String EXTRA_OPEN_KEY = "widget_open_key";
    private static final String EXTRA_ACTION_ID = "widget_completion_action_id";
    private static final String EXTRA_KIND = "completion_kind";
    private static final String EXTRA_TARGET_ID = "completion_target_id";
    private static final String EXTRA_OCCURRENCE_DATE = "completion_occurrence_date";
    private static final TimeZone SHANGHAI = TimeZone.getTimeZone("Asia/Shanghai");
    private static final String DATE_FORMAT = "yyyy-MM-dd";
    private static final ExecutorService LIST_REFRESH = Executors.newSingleThreadExecutor();

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
        if (ACTION_WIDGET_ITEM.equals(action)) {
            String owner = ScheduleWidgetStore.activeOwner(context);
            if (owner.isEmpty() || !owner.equals(intent.getStringExtra(EXTRA_OWNER))) return;
            String key = intent.getStringExtra(EXTRA_OPEN_KEY);
            if ("route:today".equals(key) || "route:todos".equals(key)) {
                Intent open = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("semesterschedule://notification?key=" + Uri.encode(key)), context, MainActivity.class);
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(open);
                return;
            }
        }
        if (ACTION_COMPLETE_ITEM.equals(action) || ACTION_WIDGET_ITEM.equals(action)) {
            String owner = ScheduleWidgetStore.activeOwner(context);
            String kind = intent.getStringExtra(EXTRA_KIND);
            String targetId = intent.getStringExtra(EXTRA_TARGET_ID);
            String occurrenceDate = intent.getStringExtra(EXTRA_OCCURRENCE_DATE);
            Uri data = intent.getData();
            String actionId = intent.getStringExtra(EXTRA_ACTION_ID);
            if (actionId == null) actionId = data == null ? "" : data.getLastPathSegment();
            if (!ScheduleWidgetStore.completionActionMatches(
                actionId,
                owner,
                kind,
                targetId,
                occurrenceDate
            )) return;
            boolean accepted = ScheduleWidgetStore.enqueueCompletion(
                context,
                owner,
                kind,
                targetId,
                occurrenceDate,
                new Date()
            );
            if (accepted) updateAll(context);
            return;
        }
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

    static void update(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_schedule);
        JSONObject snapshot = ScheduleWidgetStore.read(context);

        views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_today_title));
        views.setTextViewText(R.id.widget_date, todayLabel());
        views.setTextViewText(R.id.widget_todo_title, context.getString(R.string.widget_todo_title));

        int scheduleRequestCode = 1000 + id;
        int todoRequestCode = 2000 + id;
        setOpenIntents(context, views, new int[] {
            R.id.widget_schedule_section, R.id.widget_schedule_header, R.id.widget_title,
            R.id.widget_date, R.id.widget_empty
        }, "route:today", scheduleRequestCode);
        setOpenIntents(context, views, new int[] {
            R.id.widget_todo_section, R.id.widget_todo_header, R.id.widget_todo_title,
            R.id.widget_todo_empty
        }, "route:todos", todoRequestCode);
        setOpenIntent(context, views, R.id.widget_todo_add, "route:todos-create", 3000 + id);

        JSONArray scheduleItems = findTodayItems(snapshot);
        bindList(context, views, id, false);
        views.setTextViewText(R.id.widget_empty, context.getString(
            scheduleItems == null ? R.string.widget_empty_refresh : R.string.widget_empty));

        JSONArray todos = findTodos(snapshot);
        bindList(context, views, id, true);
        views.setTextViewText(R.id.widget_todo_empty, context.getString(
            todos == null ? R.string.widget_todo_empty_refresh : R.string.widget_todo_empty));

        manager.updateAppWidget(id, views);
        // On current Android versions this call may synchronously await the
        // factory. Its service is created on the main thread, so never block
        // that same thread from an AppWidgetProvider broadcast.
        LIST_REFRESH.execute(() -> {
            manager.notifyAppWidgetViewDataChanged(id, R.id.widget_schedule_list);
            manager.notifyAppWidgetViewDataChanged(id, R.id.widget_todo_list);
        });
    }

    private static void bindList(Context context, RemoteViews views, int id, boolean todos) {
        int listId = todos ? R.id.widget_todo_list : R.id.widget_schedule_list;
        String owner = ScheduleWidgetStore.activeOwner(context);
        Intent adapter = new Intent(context, ScheduleWidgetListService.class);
        adapter.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        adapter.putExtra(ScheduleWidgetListService.EXTRA_TODOS, todos);
        adapter.putExtra(ScheduleWidgetListService.EXTRA_OWNER, owner);
        // Adapter identity includes owner so launcher caches cannot carry rows
        // across account switches, even while a factory refresh is pending.
        adapter.setData(Uri.parse("semesterschedule://widget-list/" + id + "/"
            + (todos ? "todos" : "schedule") + "?owner=" + owner));
        views.setRemoteAdapter(listId, adapter);
        views.setEmptyView(listId, todos ? R.id.widget_todo_empty : R.id.widget_empty);

        Intent template = new Intent(context, TodayScheduleWidgetProvider.class);
        template.setAction(ACTION_WIDGET_ITEM);
        template.setData(Uri.parse("semesterschedule://widget-click/" + id + "/"
            + (todos ? "todos" : "schedule") + "?owner=" + owner));
        template.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        views.setPendingIntentTemplate(listId, PendingIntent.getBroadcast(context, 0, template, flags));
    }

    static Intent openRowIntent(String owner, boolean todos) {
        return new Intent().putExtra(EXTRA_OWNER, owner)
            .putExtra(EXTRA_OPEN_KEY, todos ? "route:todos" : "route:today");
    }

    static Intent completeRowIntent(String owner, String kind, String targetId, String date) {
        return new Intent().putExtra(EXTRA_OWNER, owner).putExtra(EXTRA_KIND, kind)
            .putExtra(EXTRA_TARGET_ID, targetId).putExtra(EXTRA_OCCURRENCE_DATE, date)
            .putExtra(EXTRA_ACTION_ID, ScheduleWidgetStore.completionActionId(owner, kind, targetId, date));
    }

    static JSONArray findTodayItems(JSONObject snapshot) {
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

    static JSONArray findTodos(JSONObject snapshot) {
        if (snapshot == null || !snapshot.has("todos")) return null;
        return snapshot.optJSONArray("todos");
    }

    static String formatScheduleItem(JSONObject item) {
        if (item == null) return "";
        String title = truncate(item.optString("title", "未命名日程"), 48, "未命名日程");
        String time = formatTime(item);
        return time.isEmpty() ? title : time + "  " + title;
    }

    static String todayDate() {
        SimpleDateFormat dateFormat = new SimpleDateFormat(DATE_FORMAT, Locale.US);
        dateFormat.setTimeZone(SHANGHAI);
        return dateFormat.format(new Date());
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
