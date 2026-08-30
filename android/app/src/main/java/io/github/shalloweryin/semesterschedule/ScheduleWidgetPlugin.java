package io.github.shalloweryin.semesterschedule;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** Capacitor bridge for publishing a validated, non-sensitive widget snapshot. */
@CapacitorPlugin(name = "ScheduleWidget")
public class ScheduleWidgetPlugin extends Plugin {
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
