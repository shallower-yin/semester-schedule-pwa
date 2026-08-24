package io.github.shalloweryin.semesterschedule;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.time.Instant;

public class HealthReminderSlotCalculatorTest {
    @Test
    public void saveAtTwoMinutesStillSchedulesTheNextWholeHour() {
        assertEquals(
            instant("2026-08-24T02:00:00Z"),
            HealthReminderSlotCalculator.nextSlotAfter(instant("2026-08-24T01:02:00Z"), 60, 9 * 60, 22 * 60)
        );
    }

    @Test
    public void lateDeliveryDoesNotShiftFollowingSlots() {
        assertEquals(
            instant("2026-08-24T03:00:00Z"),
            HealthReminderSlotCalculator.nextSlotAfter(instant("2026-08-24T02:17:00Z"), 60, 9 * 60, 22 * 60)
        );
    }

    @Test
    public void endOfWindowRollsToNextMorning() {
        assertEquals(
            instant("2026-08-25T01:00:00Z"),
            HealthReminderSlotCalculator.nextSlotAfter(instant("2026-08-24T14:00:00Z"), 60, 9 * 60, 22 * 60)
        );
    }

    @Test
    public void overnightWindowKeepsItsStartAnchoredSlots() {
        assertEquals(
            instant("2026-08-24T14:00:00Z"),
            HealthReminderSlotCalculator.nextSlotAfter(instant("2026-08-24T13:30:00Z"), 60, 22 * 60, 6 * 60)
        );
        assertEquals(
            instant("2026-08-24T18:00:00Z"),
            HealthReminderSlotCalculator.nextSlotAfter(instant("2026-08-24T17:17:00Z"), 60, 22 * 60, 6 * 60)
        );
    }

    private static long instant(String value) {
        return Instant.parse(value).toEpochMilli();
    }
}
