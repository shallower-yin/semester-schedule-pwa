package io.github.shalloweryin.semesterschedule;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/** Scrolls the native, persisted projection; never starts the WebView or calls a server. */
public class ScheduleWidgetListService extends RemoteViewsService {
    static final String EXTRA_TODOS = "widget_list_todos";
    static final String EXTRA_OWNER = "widget_list_owner";

    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent);
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context context;
        private final boolean todos;
        private final String owner;
        private volatile JSONArray items = new JSONArray();
        private String date = "";

        Factory(Context context, Intent intent) {
            this.context = context;
            todos = intent.getBooleanExtra(EXTRA_TODOS, false);
            String requestedOwner = intent.getStringExtra(EXTRA_OWNER);
            owner = requestedOwner == null ? "" : requestedOwner;
        }

        private boolean owned() {
            return !owner.isEmpty() && owner.equals(ScheduleWidgetStore.activeOwner(context));
        }

        @Override public void onCreate() {}

        @Override public void onDataSetChanged() {
            if (!owned()) { items = new JSONArray(); return; }
            JSONObject snapshot = ScheduleWidgetStore.read(context);
            date = TodayScheduleWidgetProvider.todayDate();
            JSONArray source = todos ? TodayScheduleWidgetProvider.findTodos(snapshot)
                : TodayScheduleWidgetProvider.findTodayItems(snapshot);
            items = source == null ? new JSONArray() : source;
        }

        @Override public void onDestroy() { items = new JSONArray(); }
        @Override public int getCount() { return owned() ? items.length() : 0; }

        @Override public RemoteViews getViewAt(int position) {
            JSONArray current = items;
            if (!owned() || position < 0 || position >= current.length()) return emptyRow();
            JSONObject item = current.optJSONObject(position);
            if (item == null) return emptyRow();
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_list_item);
            String title = TodayScheduleWidgetProvider.truncate(item.optString("title", ""), todos ? 64 : 48,
                todos ? context.getString(R.string.widget_todo_title) : context.getString(R.string.widget_today_title));
            row.setTextViewText(R.id.widget_list_text, todos ? title : TodayScheduleWidgetProvider.formatScheduleItem(item));
            row.setTextColor(R.id.widget_list_text, todos ? 0xff332d1b : 0xff17233d);
            row.setTextColor(R.id.widget_list_complete, todos ? 0xff9a7100 : 0xff4967c9);

            Intent open = TodayScheduleWidgetProvider.openRowIntent(owner, todos);
            row.setOnClickFillInIntent(R.id.widget_list_row, open);
            row.setOnClickFillInIntent(R.id.widget_list_text, open);
            String targetId = item.optString("targetId", "");
            boolean completable = !targetId.isEmpty() && (todos
                || (ScheduleWidgetStore.KIND_EVENT.equals(item.optString("kind", "")) && !item.optBoolean("completed", false)));
            row.setViewVisibility(R.id.widget_list_complete, completable ? View.VISIBLE : View.GONE);
            if (completable) {
                row.setContentDescription(R.id.widget_list_complete, context.getString(R.string.widget_complete_named_item, title));
                row.setOnClickFillInIntent(R.id.widget_list_complete, TodayScheduleWidgetProvider.completeRowIntent(
                    owner, todos ? ScheduleWidgetStore.KIND_TODO : ScheduleWidgetStore.KIND_EVENT, targetId, todos ? "" : date));
            }
            return row;
        }

        private RemoteViews emptyRow() {
            // Android may already be serializing a previously reported count
            // when an account switch or completion clears this dataset. Never
            // return null here: modern collection conversion dereferences it.
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_list_item);
            row.setTextViewText(R.id.widget_list_text, "");
            row.setViewVisibility(R.id.widget_list_complete, View.GONE);
            row.setViewVisibility(R.id.widget_list_row, View.GONE);
            return row;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public boolean hasStableIds() { return true; }
        @Override public long getItemId(int position) {
            JSONObject item = items.optJSONObject(position);
            if (!owned() || item == null) return -1;
            String identity = todos ? item.optString("targetId", item.optString("title", ""))
                : date + ":" + item.optString("key", "") + ":" + item.optString("targetId", "")
                    + ":" + item.optInt("startMinute", -1) + ":" + item.optInt("endMinute", -1);
            return stableId(owner + ":" + todos + ":" + identity);
        }
    }

    static long stableId(String value) {
        long hash = 0xcbf29ce484222325L;
        for (int index = 0; index < value.length(); index++) {
            hash ^= value.charAt(index);
            hash *= 0x100000001b3L;
        }
        return hash == Long.MIN_VALUE ? 0 : hash;
    }
}
