package io.github.shalloweryin.semesterschedule;

import android.appwidget.AppWidgetManager;
import android.app.Activity;
import android.content.ComponentName;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONArray;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.HashSet;
import java.util.Set;

/** Capacitor bridge for publishing a validated, non-sensitive widget snapshot. */
@CapacitorPlugin(name = "ScheduleWidget")
public class ScheduleWidgetPlugin extends Plugin {
    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", false);
        result.put("requested", false);
        result.put("alreadyAdded", false);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("status", "unsupported_android");
            call.resolve(result);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            result.put("status", "no_activity");
            call.resolve(result);
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                AppWidgetManager manager = AppWidgetManager.getInstance(activity);
                ComponentName provider = new ComponentName(activity, TodayScheduleWidgetProvider.class);
                result.put("alreadyAdded", manager.getAppWidgetIds(provider).length > 0);
                boolean supported = manager.isRequestPinAppWidgetSupported();
                result.put("supported", supported);
                if (!supported) {
                    result.put("status", "unsupported_launcher");
                    call.resolve(result);
                    return;
                }
                boolean requested = manager.requestPinAppWidget(provider, null, null);
                result.put("requested", requested);
                result.put("status", requested ? "request_accepted" : "request_rejected");
                call.resolve(result);
            } catch (Exception error) {
                result.put("status", "error");
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void setActiveOwner(PluginCall call) {
        String owner = digestOwner(ownerFrom(call));
        if (owner.isEmpty()) {
            call.reject("缺少有效的日程账号标识。");
            return;
        }
        ScheduleWidgetStore.setActiveOwner(getContext(), owner);
        TodayScheduleWidgetProvider.updateAll(getContext());
        JSObject result = new JSObject();
        result.put("accepted", true);
        result.put("active", true);
        call.resolve(result);
    }

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        String owner = digestOwner(ownerFrom(call));
        if (owner.isEmpty()) {
            call.reject("缺少有效的日程账号标识。");
            return;
        }
        JSONObject snapshot = null;
        try {
            Object raw = call.getData().opt("snapshot");
            if (raw == null) raw = call.getData().opt("snapshotJson");
            if (raw instanceof JSONObject) snapshot = (JSONObject) raw;
            else if (raw instanceof String) snapshot = new JSONObject((String) raw);
            else if (raw == null) snapshot = call.getData();
            if (snapshot != null) {
                snapshot = new JSONObject(snapshot.toString());
                // Never persist a raw account identifier. The snapshot carries only a digest.
                snapshot.remove("ownerId");
                snapshot.put("ownerDigest", owner);
            }
        } catch (Exception ignored) {
            snapshot = null;
        }
        boolean accepted = ScheduleWidgetStore.save(getContext(), owner, snapshot);
        if (accepted) TodayScheduleWidgetProvider.updateAll(getContext());
        JSObject result = new JSObject();
        result.put("accepted", accepted);
        result.put("updated", accepted);
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingCompletionActions(PluginCall call) {
        String owner = digestOwner(ownerFrom(call));
        JSObject result = new JSObject();
        boolean accepted = !owner.isEmpty() && owner.equals(ScheduleWidgetStore.activeOwner(getContext()));
        result.put("accepted", accepted);
        JSONArray actions = accepted
            ? ScheduleWidgetStore.pendingCompletions(getContext(), owner)
            : new JSONArray();
        try {
            result.put("actions", new JSArray(actions.toString()));
        } catch (Exception ignored) {
            result.put("actions", new JSArray());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void ackCompletionActions(PluginCall call) {
        String owner = digestOwner(ownerFrom(call));
        JSObject result = new JSObject();
        boolean accepted = !owner.isEmpty() && owner.equals(ScheduleWidgetStore.activeOwner(getContext()));
        result.put("accepted", accepted);
        if (!accepted) {
            result.put("acknowledged", 0);
            call.resolve(result);
            return;
        }
        Set<String> actionIds = new HashSet<>();
        JSArray values = call.getArray("actionIds", new JSArray());
        for (int index = 0; index < values.length() && actionIds.size() < 100; index++) {
            String actionId = values.optString(index, "").toLowerCase(Locale.US);
            if (actionId.matches("[0-9a-f]{64}")) actionIds.add(actionId);
        }
        int acknowledged = ScheduleWidgetStore.acknowledgeCompletions(getContext(), owner, actionIds);
        result.put("acknowledged", acknowledged);
        call.resolve(result);
    }

    @PluginMethod
    public void clearSnapshot(PluginCall call) {
        ScheduleWidgetStore.clear(getContext());
        TodayScheduleWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    private static String safeOwner(String value) {
        if (value == null) return "";
        String owner = value.trim();
        return owner.length() <= 128 ? owner : "";
    }

    private static String digestOwner(String value) {
        String owner = safeOwner(value);
        if (owner.isEmpty()) return "";
        if (owner.matches("[0-9a-fA-F]{64}")) return owner.toLowerCase(Locale.US);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(owner.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte valueByte : digest) result.append(String.format(Locale.US, "%02x", valueByte & 0xff));
            return result.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String ownerFrom(PluginCall call) {
        String owner = call.getString("ownerId", "");
        if (owner == null || owner.isEmpty()) owner = call.getString("ownerDigest", "");
        return owner;
    }
}
