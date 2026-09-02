package io.github.shalloweryin.semesterschedule;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.regex.Pattern;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;

/** Small, account-scoped snapshot shared by the web app and the home-screen widget. */
final class ScheduleWidgetStore {
    static final String PREFS = "schedule_widget";
    private static final String ACTIVE_OWNER = "active_owner";
    private static final String SNAPSHOT = "snapshot";
    private static final int MAX_BYTES = 64 * 1024;
    private static final int MAX_TODOS = 3;
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    private ScheduleWidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void setActiveOwner(Context context, String owner) {
        String next = owner == null ? "" : owner;
        SharedPreferences current = prefs(context);
        String previous = current.getString(ACTIVE_OWNER, "");
        SharedPreferences.Editor editor = current.edit();
        editor.putString(ACTIVE_OWNER, next);
        // Preserve a valid projection when the same account publishes another
        // update; clear it only on an actual account switch or logout.
        if (next.isEmpty() || !next.equals(previous)) editor.remove(SNAPSHOT);
        editor.commit();
    }

    static synchronized String activeOwner(Context context) {
        return prefs(context).getString(ACTIVE_OWNER, "");
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().remove(SNAPSHOT).remove(ACTIVE_OWNER).commit();
    }

    static synchronized boolean save(Context context, String owner, JSONObject snapshot) {
        String active = activeOwner(context);
        if (active.isEmpty() || owner == null || !active.equals(owner) || snapshot == null) return false;
        if (!validate(owner, snapshot)) return false;
        String encoded = snapshot.toString();
        if (encoded.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BYTES) return false;
        if (encoded.equals(prefs(context).getString(SNAPSHOT, null))) return true;
        prefs(context).edit().putString(SNAPSHOT, encoded).commit();
        return true;
    }

    static synchronized JSONObject read(Context context) {
        String encoded = prefs(context).getString(SNAPSHOT, null);
        if (encoded == null || encoded.isEmpty()) return null;
        try {
            JSONObject value = new JSONObject(encoded);
            // Raw owner IDs must never survive in the native projection. Older
            // builds may have written one; discard it rather than displaying it.
            if (value.has("ownerId")) return null;
            String owner = value.optString("ownerDigest", "");
            if (!owner.equals(activeOwner(context)) || !validate(owner, value)) return null;
            return value;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean validate(String owner, JSONObject value) {
        if (owner == null || !owner.matches("[0-9a-fA-F]{64}")) return false;
        if (value.optInt("schema", -1) != 1) return false;
        if (value.has("ownerId")) return false;
        String snapshotOwner = value.optString("ownerDigest", "");
        if (!owner.equals(snapshotOwner)) return false;
        String timezone = value.optString("timezone", "Asia/Shanghai");
        if (!"Asia/Shanghai".equals(timezone)) return false;
        String generatedAt = value.optString("generatedAt", "");
        if (generatedAt.isEmpty() || generatedAt.length() > 80 || parseIsoDate(generatedAt) == null) return false;
        String validUntil = value.optString("validUntil", "");
        if (validUntil.isEmpty() || validUntil.length() > 80) return false;
        Date expiry = parseIsoDate(validUntil);
        if (expiry == null || expiry.getTime() <= System.currentTimeMillis()) return false;
        JSONArray days = value.optJSONArray("days");
        if (days == null || days.length() < 1 || days.length() > 7) return false;
        Set<String> seenDates = new HashSet<>();
        for (int i = 0; i < days.length(); i++) {
            JSONObject day = days.optJSONObject(i);
            String date = day != null ? day.optString("date", "") : "";
            if (day == null || !DATE.matcher(date).matches() || !isValidCalendarDate(date) || !seenDates.add(date)) return false;
            JSONArray items = day.optJSONArray("items");
            if (items == null || items.length() > 8) return false;
            for (int j = 0; j < items.length(); j++) {
                JSONObject item = items.optJSONObject(j);
                if (item == null) return false;
                String kind = item.optString("kind", "");
                if (!("event".equals(kind) || "course".equals(kind))) return false;
                if (item.optString("key", "").trim().isEmpty() || item.optString("key", "").length() > 160
                    || item.optString("targetId", "").trim().isEmpty() || item.optString("targetId", "").length() > 160) return false;
                String title = item.optString("title", "");
                if (title.trim().isEmpty() || title.codePointCount(0, title.length()) > 80) return false;
                if (item.has("allDay") && !(item.opt("allDay") instanceof Boolean)) return false;
                if (item.has("completed") && !(item.opt("completed") instanceof Boolean)) return false;
                if (!validMinute(item, "startMinute") || !validMinute(item, "endMinute")) return false;
            }
        }
        // Optional keeps schema 1 backward compatible: legacy snapshots have
        // no todo projection, while an explicit empty array means "all done".
        if (value.has("todos")) {
            JSONArray todos = value.optJSONArray("todos");
            if (todos == null || todos.length() > MAX_TODOS) return false;
            for (int i = 0; i < todos.length(); i++) {
                JSONObject todo = todos.optJSONObject(i);
                if (todo == null || todo.length() != 1 || !(todo.opt("title") instanceof String)) return false;
                String title = todo.optString("title", "");
                if (title.trim().isEmpty() || title.codePointCount(0, title.length()) > 80) return false;
            }
        }
        return true;
    }

    private static Date parseIsoDate(String value) {
        try {
            if (value == null || value.length() < 19) return null;
            String prefix = value.substring(0, 19);
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            parser.setLenient(false);
            parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            return parser.parse(prefix);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean isValidCalendarDate(String value) {
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            parser.setLenient(false);
            parser.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
            return parser.parse(value) != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean validMinute(JSONObject item, String key) {
        if (!item.has(key) || item.isNull(key)) return true;
        int minute = item.optInt(key, -1);
        return minute >= 0 && minute <= 1439;
    }
}
