package io.github.shalloweryin.semesterschedule;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Pattern;

/** Small, account-scoped snapshot and completion outbox shared with the launcher widget. */
final class ScheduleWidgetStore {
    static final String PREFS = "schedule_widget";
    static final String KIND_TODO = "todo";
    static final String KIND_EVENT = "event";
    private static final String ACTIVE_OWNER = "active_owner";
    private static final String SNAPSHOT = "snapshot";
    private static final String OUTBOX_PREFIX = "completion_outbox.";
    private static final String HIDDEN_PREFIX = "completion_hidden.";
    private static final String SOURCE_ABSENT_OBSERVED = "sourceAbsentObserved";
    private static final int MAX_BYTES = 64 * 1024;
    private static final int MAX_TODOS = 3;
    private static final int MAX_COMPLETION_ACTIONS = 100;
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern OWNER_DIGEST = Pattern.compile("[0-9a-fA-F]{64}");

    private ScheduleWidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void setActiveOwner(Context context, String owner) {
        String next = validOwner(owner) ? owner.toLowerCase(Locale.US) : "";
        SharedPreferences current = prefs(context);
        String previous = current.getString(ACTIVE_OWNER, "");
        SharedPreferences.Editor editor = current.edit();
        editor.putString(ACTIVE_OWNER, next);
        // Outboxes are keyed by a one-way owner digest and survive account
        // switches. The visible projection must never survive such a switch.
        if (next.isEmpty() || !next.equals(previous)) editor.remove(SNAPSHOT);
        editor.commit();
    }

    static synchronized String activeOwner(Context context) {
        return prefs(context).getString(ACTIVE_OWNER, "");
    }

    static synchronized void clear(Context context) {
        SharedPreferences current = prefs(context);
        SharedPreferences.Editor editor = current.edit().remove(SNAPSHOT).remove(ACTIVE_OWNER);
        for (String key : current.getAll().keySet()) {
            if (key.startsWith(OUTBOX_PREFIX) || key.startsWith(HIDDEN_PREFIX)) editor.remove(key);
        }
        editor.commit();
    }

    static synchronized boolean save(Context context, String owner, JSONObject snapshot) {
        String normalizedOwner = normalizeOwner(owner);
        String active = activeOwner(context);
        if (normalizedOwner.isEmpty() || !active.equals(normalizedOwner) || snapshot == null) return false;
        if (!validate(normalizedOwner, snapshot)) return false;

        try {
            SharedPreferences current = prefs(context);
            JSONObject filtered = new JSONObject(snapshot.toString());
            JSONArray pending = readArray(current, outboxKey(normalizedOwner));
            JSONArray hidden = readArray(current, hiddenKey(normalizedOwner));
            JSONArray retainedHidden = new JSONArray();

            for (int index = 0; index < pending.length(); index++) {
                JSONObject action = pending.optJSONObject(index);
                if (!validateCompletionAction(action)) continue;
                boolean sourceContainsTarget = containsCompletionTarget(snapshot, action);
                if (nextSourceAbsentObserved(action.optBoolean(SOURCE_ABSENT_OBSERVED, false), sourceContainsTarget)) {
                    action.put(SOURCE_ABSENT_OBSERVED, true);
                }
                filterCompletionTarget(filtered, action);
            }
            // Acknowledged targets stay suppressed until a later WebView
            // projection proves that the Dexie mutation is visible. This
            // prevents a stale React render racing the acknowledgement and
            // briefly resurrecting a completed row.
            for (int index = 0; index < hidden.length(); index++) {
                JSONObject action = hidden.optJSONObject(index);
                if (!validateCompletionAction(action)) continue;
                if (containsCompletionTarget(snapshot, action)) {
                    filterCompletionTarget(filtered, action);
                    retainedHidden.put(action);
                }
            }

            if (!validate(normalizedOwner, filtered)) return false;
            String encoded = filtered.toString();
            if (encoded.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) return false;
            SharedPreferences.Editor editor = current.edit();
            if (!encoded.equals(current.getString(SNAPSHOT, null))) editor.putString(SNAPSHOT, encoded);
            putArray(editor, outboxKey(normalizedOwner), pending);
            putArray(editor, hiddenKey(normalizedOwner), retainedHidden);
            return editor.commit();
        } catch (Exception ignored) {
            return false;
        }
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

    static synchronized boolean enqueueCompletion(
        Context context,
        String owner,
        String kind,
        String targetId,
        String occurrenceDate,
        Date createdAt
    ) {
        String normalizedOwner = normalizeOwner(owner);
        if (normalizedOwner.isEmpty() || !normalizedOwner.equals(activeOwner(context))) return false;
        JSONObject snapshot = read(context);
        if (snapshot == null) return false;
        try {
            String actionId = completionActionId(normalizedOwner, kind, targetId, occurrenceDate);
            if (actionId.isEmpty()) return false;
            JSONObject action = new JSONObject();
            action.put("actionId", actionId);
            action.put("kind", kind);
            action.put("targetId", targetId);
            if (KIND_EVENT.equals(kind)) action.put("occurrenceDate", occurrenceDate);
            action.put("createdAt", isoTimestamp(createdAt == null ? new Date() : createdAt));
            if (!validateCompletionAction(action) || !containsCompletionTarget(snapshot, action)) return false;

            SharedPreferences current = prefs(context);
            JSONArray pending = readArray(current, outboxKey(normalizedOwner));
            JSONArray hidden = readArray(current, hiddenKey(normalizedOwner));
            if (containsActionId(pending, actionId) || containsActionId(hidden, actionId)) {
                filterCompletionTarget(snapshot, action);
                return current.edit().putString(SNAPSHOT, snapshot.toString()).commit();
            }
            if (pending.length() >= MAX_COMPLETION_ACTIONS) return false;
            pending.put(action);
            filterCompletionTarget(snapshot, action);
            return current.edit()
                .putString(outboxKey(normalizedOwner), pending.toString())
                .putString(SNAPSHOT, snapshot.toString())
                .commit();
        } catch (Exception ignored) {
            return false;
        }
    }

    static synchronized JSONArray pendingCompletions(Context context, String owner) {
        String normalizedOwner = normalizeOwner(owner);
        if (normalizedOwner.isEmpty() || !normalizedOwner.equals(activeOwner(context))) return new JSONArray();
        try {
            JSONArray actions = new JSONArray(readArray(prefs(context), outboxKey(normalizedOwner)).toString());
            for (int index = 0; index < actions.length(); index++) {
                JSONObject action = actions.optJSONObject(index);
                if (action != null) action.remove(SOURCE_ABSENT_OBSERVED);
            }
            return actions;
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    static synchronized int acknowledgeCompletions(Context context, String owner, Set<String> actionIds) {
        String normalizedOwner = normalizeOwner(owner);
        if (normalizedOwner.isEmpty() || !normalizedOwner.equals(activeOwner(context))
            || actionIds == null || actionIds.isEmpty()) return 0;
        SharedPreferences current = prefs(context);
        JSONArray pending = readArray(current, outboxKey(normalizedOwner));
        JSONArray hidden = readArray(current, hiddenKey(normalizedOwner));
        JSONArray retained = new JSONArray();
        int acknowledged = 0;
        for (int index = 0; index < pending.length(); index++) {
            JSONObject action = pending.optJSONObject(index);
            String actionId = action == null ? "" : action.optString("actionId", "").toLowerCase(Locale.US);
            if (action != null && actionIds.contains(actionId)) {
                acknowledged += 1;
                boolean sourceAbsentObserved = action.optBoolean(SOURCE_ABSENT_OBSERVED, false);
                action.remove(SOURCE_ABSENT_OBSERVED);
                if (needsHiddenAfterAcknowledgement(sourceAbsentObserved) && !containsActionId(hidden, actionId)) {
                    hidden.put(action);
                }
            } else if (action != null && validateCompletionAction(action)) {
                retained.put(action);
            }
        }
        hidden = tail(hidden, MAX_COMPLETION_ACTIONS);
        if (acknowledged > 0) {
            SharedPreferences.Editor editor = current.edit();
            putArray(editor, outboxKey(normalizedOwner), retained);
            putArray(editor, hiddenKey(normalizedOwner), hidden);
            if (!editor.commit()) return 0;
        }
        return acknowledged;
    }

    static String completionActionId(String owner, String kind, String targetId, String occurrenceDate) {
        String normalizedOwner = normalizeOwner(owner);
        String normalizedKind = kind == null ? "" : kind.trim();
        String normalizedTarget = safeTargetId(targetId);
        String normalizedDate = occurrenceDate == null ? "" : occurrenceDate.trim();
        if (normalizedOwner.isEmpty() || normalizedTarget.isEmpty()) return "";
        if (KIND_TODO.equals(normalizedKind)) {
            if (!normalizedDate.isEmpty()) return "";
        } else if (KIND_EVENT.equals(normalizedKind)) {
            if (!validDate(normalizedDate)) return "";
        } else {
            return "";
        }
        try {
            String value = normalizedOwner + "\n" + normalizedKind + "\n" + normalizedTarget + "\n" + normalizedDate + "\ncomplete";
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte item : digest) result.append(String.format(Locale.US, "%02x", item & 0xff));
            return result.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    static boolean completionActionMatches(
        String actionId,
        String owner,
        String kind,
        String targetId,
        String occurrenceDate
    ) {
        String expected = completionActionId(owner, kind, targetId, occurrenceDate);
        return !expected.isEmpty() && actionId != null && expected.equalsIgnoreCase(actionId);
    }

    static boolean validateCompletionAction(JSONObject action) {
        if (action == null || action.length() < 4 || action.length() > 6) return false;
        String actionId = action.optString("actionId", "");
        String kind = action.optString("kind", "");
        String targetId = safeTargetId(action.optString("targetId", ""));
        String occurrenceDate = action.optString("occurrenceDate", "");
        String createdAt = action.optString("createdAt", "");
        if (!actionId.matches("[0-9a-fA-F]{64}") || targetId.isEmpty() || parseIsoDate(createdAt) == null) return false;
        if (KIND_TODO.equals(kind) && action.has("occurrenceDate")) return false;
        if (KIND_EVENT.equals(kind) && !validDate(occurrenceDate)) return false;
        if (!KIND_TODO.equals(kind) && !KIND_EVENT.equals(kind)) return false;
        if (action.has(SOURCE_ABSENT_OBSERVED) && !(action.opt(SOURCE_ABSENT_OBSERVED) instanceof Boolean)) return false;
        Iterator<String> keys = action.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!"actionId".equals(key) && !"kind".equals(key) && !"targetId".equals(key)
                && !"occurrenceDate".equals(key) && !"createdAt".equals(key)
                && !SOURCE_ABSENT_OBSERVED.equals(key)) return false;
        }
        return true;
    }

    static boolean nextSourceAbsentObserved(boolean previous, boolean sourceContainsTarget) {
        return previous || !sourceContainsTarget;
    }

    static boolean needsHiddenAfterAcknowledgement(boolean sourceAbsentObserved) {
        return !sourceAbsentObserved;
    }

    static boolean containsCompletionTarget(JSONObject snapshot, JSONObject action) {
        if (snapshot == null || !validateCompletionAction(action)) return false;
        String targetId = action.optString("targetId", "");
        if (KIND_TODO.equals(action.optString("kind", ""))) {
            JSONArray todos = snapshot.optJSONArray("todos");
            if (todos == null) return false;
            for (int index = 0; index < todos.length(); index++) {
                JSONObject todo = todos.optJSONObject(index);
                if (todo != null && targetId.equals(todo.optString("targetId", ""))) return true;
            }
            return false;
        }
        String occurrenceDate = action.optString("occurrenceDate", "");
        JSONArray days = snapshot.optJSONArray("days");
        if (days == null) return false;
        for (int dayIndex = 0; dayIndex < days.length(); dayIndex++) {
            JSONObject day = days.optJSONObject(dayIndex);
            if (day == null || !occurrenceDate.equals(day.optString("date", ""))) continue;
            JSONArray items = day.optJSONArray("items");
            if (items == null) return false;
            for (int itemIndex = 0; itemIndex < items.length(); itemIndex++) {
                JSONObject item = items.optJSONObject(itemIndex);
                if (item != null && KIND_EVENT.equals(item.optString("kind", ""))
                    && !item.optBoolean("completed", false)
                    && targetId.equals(item.optString("targetId", ""))) return true;
            }
        }
        return false;
    }

    static void filterCompletionTarget(JSONObject snapshot, JSONObject action) {
        if (snapshot == null || !validateCompletionAction(action)) return;
        String targetId = action.optString("targetId", "");
        if (KIND_TODO.equals(action.optString("kind", ""))) {
            JSONArray todos = snapshot.optJSONArray("todos");
            if (todos != null) removeMatching(todos, item -> targetId.equals(item.optString("targetId", "")));
            return;
        }
        String occurrenceDate = action.optString("occurrenceDate", "");
        JSONArray days = snapshot.optJSONArray("days");
        if (days == null) return;
        for (int dayIndex = 0; dayIndex < days.length(); dayIndex++) {
            JSONObject day = days.optJSONObject(dayIndex);
            if (day == null || !occurrenceDate.equals(day.optString("date", ""))) continue;
            JSONArray items = day.optJSONArray("items");
            if (items == null) continue;
            removeMatching(items, item -> KIND_EVENT.equals(item.optString("kind", ""))
                && targetId.equals(item.optString("targetId", "")));
        }
    }

    private interface JsonMatcher { boolean matches(JSONObject value); }

    private static void removeMatching(JSONArray values, JsonMatcher matcher) {
        for (int index = values.length() - 1; index >= 0; index--) {
            JSONObject value = values.optJSONObject(index);
            if (value != null && matcher.matches(value)) values.remove(index);
        }
    }

    private static boolean validate(String owner, JSONObject value) {
        if (!validOwner(owner)) return false;
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
            if (day == null || !validDate(date) || !seenDates.add(date)) return false;
            JSONArray items = day.optJSONArray("items");
            if (items == null || items.length() > 8) return false;
            for (int j = 0; j < items.length(); j++) {
                JSONObject item = items.optJSONObject(j);
                if (item == null) return false;
                String kind = item.optString("kind", "");
                if (!("event".equals(kind) || "course".equals(kind))) return false;
                if (safeTargetId(item.optString("key", "")).isEmpty()
                    || safeTargetId(item.optString("targetId", "")).isEmpty()) return false;
                String title = item.optString("title", "");
                if (title.trim().isEmpty() || title.codePointCount(0, title.length()) > 80) return false;
                if (item.has("allDay") && !(item.opt("allDay") instanceof Boolean)) return false;
                if (item.has("completed") && !(item.opt("completed") instanceof Boolean)) return false;
                if (!validMinute(item, "startMinute") || !validMinute(item, "endMinute")) return false;
            }
        }
        // Optional keeps schema 1 backward compatible: legacy snapshots have
        // no todo projection or contain title-only todo rows.
        if (value.has("todos")) {
            JSONArray todos = value.optJSONArray("todos");
            if (todos == null || todos.length() > MAX_TODOS) return false;
            for (int i = 0; i < todos.length(); i++) {
                JSONObject todo = todos.optJSONObject(i);
                if (todo == null || todo.length() < 1 || todo.length() > 2 || !(todo.opt("title") instanceof String)) return false;
                String title = todo.optString("title", "");
                if (title.trim().isEmpty() || title.codePointCount(0, title.length()) > 80) return false;
                if (todo.has("targetId") && safeTargetId(todo.optString("targetId", "")).isEmpty()) return false;
                Iterator<String> keys = todo.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    if (!"title".equals(key) && !"targetId".equals(key)) return false;
                }
            }
        }
        return true;
    }

    private static JSONArray readArray(SharedPreferences preferences, String key) {
        String encoded = preferences.getString(key, null);
        if (encoded == null || encoded.isEmpty()) return new JSONArray();
        try {
            JSONArray parsed = new JSONArray(encoded);
            JSONArray valid = new JSONArray();
            Set<String> seen = new HashSet<>();
            for (int index = 0; index < parsed.length() && valid.length() < MAX_COMPLETION_ACTIONS; index++) {
                JSONObject action = parsed.optJSONObject(index);
                String actionId = action == null ? "" : action.optString("actionId", "").toLowerCase(Locale.US);
                if (validateCompletionAction(action) && seen.add(actionId)) valid.put(action);
            }
            return valid;
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static void putArray(SharedPreferences.Editor editor, String key, JSONArray value) {
        if (value == null || value.length() == 0) editor.remove(key);
        else editor.putString(key, value.toString());
    }

    private static JSONArray tail(JSONArray values, int limit) {
        JSONArray result = new JSONArray();
        int start = Math.max(0, values.length() - limit);
        for (int index = start; index < values.length(); index++) {
            JSONObject value = values.optJSONObject(index);
            if (value != null) result.put(value);
        }
        return result;
    }

    private static boolean containsActionId(JSONArray actions, String actionId) {
        for (int index = 0; index < actions.length(); index++) {
            JSONObject action = actions.optJSONObject(index);
            if (action != null && actionId.equalsIgnoreCase(action.optString("actionId", ""))) return true;
        }
        return false;
    }

    private static String outboxKey(String owner) { return OUTBOX_PREFIX + owner; }
    private static String hiddenKey(String owner) { return HIDDEN_PREFIX + owner; }

    private static String safeTargetId(String value) {
        if (value == null) return "";
        String target = value.trim();
        if (!target.equals(value) || target.isEmpty() || target.length() > 160) return "";
        for (int index = 0; index < target.length(); index++) {
            char item = target.charAt(index);
            if (item < 32 || item == 127) return "";
        }
        return target;
    }

    private static boolean validOwner(String owner) {
        return owner != null && OWNER_DIGEST.matcher(owner).matches();
    }

    private static String normalizeOwner(String owner) {
        return validOwner(owner) ? owner.toLowerCase(Locale.US) : "";
    }

    private static Date parseIsoDate(String value) {
        try {
            if (value == null || value.length() < 19 || value.length() > 80) return null;
            String prefix = value.substring(0, 19);
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            parser.setLenient(false);
            parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            return parser.parse(prefix);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean validDate(String value) {
        if (value == null || !DATE.matcher(value).matches()) return false;
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

    private static String isoTimestamp(Date value) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(value);
    }
}
