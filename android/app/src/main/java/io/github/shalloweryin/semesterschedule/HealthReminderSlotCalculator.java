package io.github.shalloweryin.semesterschedule;

import java.util.Calendar;
import java.util.TimeZone;

/** Computes wall-clock health reminder slots anchored to the configured window start. */
final class HealthReminderSlotCalculator {
    private static final TimeZone PRODUCT_TIME_ZONE = TimeZone.getTimeZone("Asia/Shanghai");

    private HealthReminderSlotCalculator() {}

    static long nextSlotAfter(long afterExclusive, int intervalMinutes, int startMinutes, int endMinutes) {
        int safeInterval = Math.max(15, Math.min(240, intervalMinutes));
        int safeStart = Math.max(0, Math.min(1439, startMinutes));
        int safeEnd = Math.max(0, Math.min(1439, endMinutes));
        Calendar reference = Calendar.getInstance(PRODUCT_TIME_ZONE);
        reference.setTimeInMillis(afterExclusive);
        Calendar todayStart = atMinute(reference, safeStart);

        if (safeStart <= safeEnd) {
            Calendar todayEnd = atMinute(reference, safeEnd);
            if (afterExclusive < todayStart.getTimeInMillis()) return todayStart.getTimeInMillis();
            if (afterExclusive >= todayEnd.getTimeInMillis()) return addDays(todayStart, 1).getTimeInMillis();
            return candidateOrNextWindow(afterExclusive, todayStart, todayEnd, safeInterval);
        }

        Calendar todayEnd = atMinute(reference, safeEnd);
        if (afterExclusive <= todayEnd.getTimeInMillis()) {
            Calendar previousStart = addDays(todayStart, -1);
            return candidateOrNextWindow(afterExclusive, previousStart, todayEnd, safeInterval);
        }
        if (afterExclusive < todayStart.getTimeInMillis()) return todayStart.getTimeInMillis();
        Calendar tomorrowEnd = addDays(todayEnd, 1);
        return candidateOrNextWindow(afterExclusive, todayStart, tomorrowEnd, safeInterval);
    }

    private static long candidateOrNextWindow(
        long afterExclusive,
        Calendar windowStart,
        Calendar windowEnd,
        int intervalMinutes
    ) {
        long intervalMillis = intervalMinutes * 60_000L;
        long elapsed = Math.max(0L, afterExclusive - windowStart.getTimeInMillis());
        long candidate = windowStart.getTimeInMillis() + (elapsed / intervalMillis + 1L) * intervalMillis;
        if (candidate <= windowEnd.getTimeInMillis()) return candidate;
        return addDays(windowStart, 1).getTimeInMillis();
    }

    private static Calendar atMinute(Calendar reference, int minuteOfDay) {
        Calendar result = (Calendar) reference.clone();
        result.set(Calendar.HOUR_OF_DAY, minuteOfDay / 60);
        result.set(Calendar.MINUTE, minuteOfDay % 60);
        result.set(Calendar.SECOND, 0);
        result.set(Calendar.MILLISECOND, 0);
        return result;
    }

    private static Calendar addDays(Calendar source, int amount) {
        Calendar result = (Calendar) source.clone();
        result.add(Calendar.DAY_OF_MONTH, amount);
        return result;
    }
}
