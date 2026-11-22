package io.github.shalloweryin.semesterschedule;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.PixelFormat;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.ListView;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** Run only against an isolated emulator; never overwrite an existing widget projection. */
@RunWith(AndroidJUnit4.class)
public class WidgetScrollingTest {
    private static final int HOST_WIDTH_DP = 360;
    private static final int HOST_HEIGHT_DP = 180;
    private static final String OWNER = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private Context context;
    private AppWidgetHost host;
    private AppWidgetHostView view;
    private WindowManager windowManager;
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Test public void scrollPastFiveCompleteCorrectRowsAndClearOnAccountSwitch() throws Exception {
        context = instrumentation.getTargetContext();
        assertTrue("Use an isolated emulator with an empty widget cache",
            context.getSharedPreferences(ScheduleWidgetStore.PREFS, Context.MODE_PRIVATE).getAll().isEmpty());
        instrumentation.getUiAutomation().adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET");
        try {
            ScheduleWidgetStore.setActiveOwner(context, OWNER);
            assertTrue(ScheduleWidgetStore.save(context, OWNER, snapshot()));
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            host = onMain(() -> new AppWidgetHost(context, 9236));
            widgetId = host.allocateAppWidgetId();
            assertTrue(manager.bindAppWidgetIdIfAllowed(widgetId,
                new ComponentName(context, TodayScheduleWidgetProvider.class)));
            Bundle size = new Bundle();
            size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, HOST_WIDTH_DP);
            size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, HOST_WIDTH_DP);
            size.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, HOST_HEIGHT_DP);
            size.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, HOST_HEIGHT_DP);
            manager.updateAppWidgetOptions(widgetId, size);
            onMain(() -> {
                host.startListening();
                view = host.createView(context, widgetId, manager.getAppWidgetInfo(widgetId));
                // A detached ListView has no traversal to execute setSelection.
                // Attach this test host to a real isolated-emulator window.
                float density = context.getResources().getDisplayMetrics().density;
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    Math.round(HOST_WIDTH_DP * density), Math.round(HOST_HEIGHT_DP * density),
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP | Gravity.LEFT;
                windowManager = context.getSystemService(WindowManager.class);
                windowManager.addView(view, params);
                return null;
            });
            TodayScheduleWidgetProvider.update(context, manager, widgetId);
            waitUntil(() -> onMain(() -> {
                layout();
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                return populated(schedule, 12) && populated(todos, 12);
            }));
            onMain(() -> {
                assertCompactRows(view.findViewById(R.id.widget_schedule_list));
                assertCompactRows(view.findViewById(R.id.widget_todo_list));
                saveImage("widget-scroll-initial.png");
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                // Compact hosts expose fewer rows, so use repeated swipes.
                for (int swipe = 0; swipe < 12; swipe++) {
                    schedule.scrollListBy(schedule.getHeight());
                    todos.scrollListBy(todos.getHeight());
                }
                return null;
            });
            waitUntil(() -> onMain(() -> {
                layout();
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                return atLaterItem(schedule) && atLaterItem(todos);
            }));
            String[] completedIds = onMain(() -> {
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                assertCompactRows(schedule); assertCompactRows(todos);
                saveImage("widget-scroll-later.png");
                int eventPosition = schedule.getFirstVisiblePosition();
                int todoPosition = todos.getFirstVisiblePosition();
                schedule.getChildAt(0).findViewById(R.id.widget_list_complete).performClick();
                todos.getChildAt(0).findViewById(R.id.widget_list_complete).performClick();
                return new String[] {"event-" + eventPosition, "todo-" + todoPosition};
            });
            waitUntil(() -> {
                JSONArray actions = ScheduleWidgetStore.pendingCompletions(context, OWNER);
                return actions.length() == 2;
            });
            JSONArray actions = ScheduleWidgetStore.pendingCompletions(context, OWNER);
            assertTrue(actions.toString().contains(completedIds[0]));
            assertTrue(actions.toString().contains(completedIds[1]));
            waitUntil(() -> onMain(() -> {
                layout();
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                return schedule.getCount() == 11 && todos.getCount() == 11;
            }));
            ScheduleWidgetStore.setActiveOwner(context,
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
            TodayScheduleWidgetProvider.update(context, manager, widgetId);
            waitUntil(() -> onMain(() -> {
                layout();
                ListView schedule = view.findViewById(R.id.widget_schedule_list);
                ListView todos = view.findViewById(R.id.widget_todo_list);
                return schedule.getCount() == 0 && todos.getCount() == 0;
            }));
            assertNull(ScheduleWidgetStore.read(context));
        } finally {
            if (windowManager != null && view != null) onMain(() -> { windowManager.removeViewImmediate(view); return null; });
            if (host != null) {
                if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) host.deleteAppWidgetId(widgetId);
                host.stopListening();
                host.deleteHost();
            }
            ScheduleWidgetStore.clear(context);
            instrumentation.getUiAutomation().dropShellPermissionIdentity();
        }
    }

    private JSONObject snapshot() throws Exception {
        JSONArray days = new JSONArray();
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        for (int day = 0; day < 2; day++) {
            String date = today.plusDays(day).toString();
            JSONArray items = new JSONArray();
            for (int index = 0; index < 12; index++) {
                items.put(new JSONObject().put("kind", "event").put("targetId", "event-" + index)
                    .put("key", "event:event-" + index + ":" + date).put("title", "Schedule " + (index + 1))
                    .put("startMinute", 540 + index * 10).put("endMinute", 550 + index * 10)
                    .put("allDay", false).put("completed", false));
            }
            days.put(new JSONObject().put("date", date).put("items", items));
        }
        JSONArray todos = new JSONArray();
        for (int index = 0; index < 12; index++) todos.put(new JSONObject().put("title", "Todo " + (index + 1)).put("targetId", "todo-" + index));
        return new JSONObject().put("schema", 1).put("ownerDigest", OWNER).put("timezone", "Asia/Shanghai")
            .put("generatedAt", Instant.now().toString()).put("validUntil", Instant.now().plusSeconds(172800).toString())
            .put("days", days).put("todos", todos);
    }

    private void layout() {
        float density = context.getResources().getDisplayMetrics().density;
        int width = Math.round(HOST_WIDTH_DP * density), height = Math.round(HOST_HEIGHT_DP * density);
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);
    }

    private boolean populated(ListView list, int count) {
        return list != null && list.getCount() == count && list.getChildCount() > 0
            && list.getChildAt(0).findViewById(R.id.widget_list_text) != null;
    }

    private boolean atLaterItem(ListView list) {
        if (!populated(list, 12) || list.getFirstVisiblePosition() < 5) return false;
        TextView text = list.getChildAt(0).findViewById(R.id.widget_list_text);
        return text.getText().toString().contains(String.valueOf(list.getFirstVisiblePosition() + 1));
    }

    private void assertVisibleLimit(ListView list) {
        int visible = list.getLastVisiblePosition() - list.getFirstVisiblePosition() + 1;
        if (visible <= 0 || visible > 5) saveImage("widget-scroll-failure.png");
        assertTrue("Expected 1..5 visible rows, got " + visible + "; viewport=" + list.getHeight()
            + "; row=" + (list.getChildCount() > 0 ? list.getChildAt(0).getHeight() : 0), visible > 0 && visible <= 5);
    }

    private void assertCompactRows(ListView list) {
        assertVisibleLimit(list);
        assertTrue("The list viewport must fit the compact host", list.getHeight() <= ((View) list.getParent()).getHeight());
        int expected = Math.round(22 * context.getResources().getDisplayMetrics().scaledDensity);
        for (int index = 0; index < list.getChildCount(); index++) {
            View row = list.getChildAt(index);
            assertEquals("Row height must not grow with widget height", expected, row.getHeight());
            if (index > 0) assertEquals("No extra gap between items", list.getChildAt(index - 1).getBottom(), row.getTop());
        }
    }

    private void saveImage(String name) {
        Bitmap bitmap = Bitmap.createBitmap(view.getWidth(), view.getHeight(), Bitmap.Config.ARGB_8888);
        view.draw(new Canvas(bitmap));
        try (FileOutputStream output = new FileOutputStream(new File(context.getCacheDir(), name))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        } catch (Exception error) { throw new AssertionError(error); }
        finally { bitmap.recycle(); }
    }

    private <T> T onMain(Supplier<T> operation) {
        AtomicReference<T> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            try { result.set(operation.get()); }
            catch (Throwable error) { failure.set(error); }
        });
        if (failure.get() != null) throw new AssertionError(failure.get());
        return result.get();
    }

    private void waitUntil(BooleanSupplier condition) {
        long deadline = SystemClock.uptimeMillis() + 20000;
        do {
            instrumentation.waitForIdleSync();
            if (condition.getAsBoolean()) return;
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        String state = onMain(() -> {
            if (view == null) return "no host view";
            layout(); saveImage("widget-scroll-failure.png");
            StringBuilder message = new StringBuilder();
            for (int id : new int[] {R.id.widget_schedule_list, R.id.widget_todo_list}) {
                ListView list = view.findViewById(id);
                message.append(" list=").append(id).append(" count=").append(list.getCount())
                    .append(" first=").append(list.getFirstVisiblePosition()).append(" last=").append(list.getLastVisiblePosition());
                if (list.getChildCount() > 0) {
                    TextView text = list.getChildAt(0).findViewById(R.id.widget_list_text);
                    message.append(" text=").append(text == null ? "loading" : text.getText());
                }
            }
            return message.toString();
        });
        fail("Timed out waiting for native widget data/layout: " + state);
    }
}
