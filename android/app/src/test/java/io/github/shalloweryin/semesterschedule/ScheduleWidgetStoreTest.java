package io.github.shalloweryin.semesterschedule;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ScheduleWidgetStoreTest {
    private static final String OWNER_A = repeat('a', 64);
    private static final String OWNER_B = repeat('b', 64);

    @Test
    public void completionActionIdIsDeterministicAndAccountScoped() {
        String first = ScheduleWidgetStore.completionActionId(OWNER_A, "todo", "todo-1", "");
        String second = ScheduleWidgetStore.completionActionId(OWNER_A.toUpperCase(), "todo", "todo-1", null);
        String otherOwner = ScheduleWidgetStore.completionActionId(OWNER_B, "todo", "todo-1", "");

        assertEquals(first, second);
        assertEquals(64, first.length());
        assertTrue(first.matches("[0-9a-f]{64}"));
        assertNotEquals(first, otherOwner);
    }

    @Test
    public void eventActionIdIncludesOccurrenceDate() {
        String firstDate = ScheduleWidgetStore.completionActionId(OWNER_A, "event", "event-1", "2026-09-03");
        String secondDate = ScheduleWidgetStore.completionActionId(OWNER_A, "event", "event-1", "2026-09-04");

        assertFalse(firstDate.isEmpty());
        assertNotEquals(firstDate, secondDate);
        assertEquals("", ScheduleWidgetStore.completionActionId(OWNER_A, "event", "event-1", "2026-02-30"));
        assertEquals("", ScheduleWidgetStore.completionActionId(OWNER_A, "todo", "todo-1", "2026-09-03"));
        assertEquals("", ScheduleWidgetStore.completionActionId(OWNER_A, "course", "course-1", "2026-09-03"));
    }

    @Test
    public void malformedOwnerAndTargetAreRejected() {
        assertEquals("", ScheduleWidgetStore.completionActionId("alice", "todo", "todo-1", ""));
        assertEquals("", ScheduleWidgetStore.completionActionId(OWNER_A, "todo", " todo-1", ""));
        assertEquals("", ScheduleWidgetStore.completionActionId(OWNER_A, "todo", "todo\n1", ""));
    }

    @Test
    public void completionIntentActionIsBoundToTheActiveOwner() {
        String actionId = ScheduleWidgetStore.completionActionId(OWNER_A, "todo", "todo-1", "");

        assertTrue(ScheduleWidgetStore.completionActionMatches(actionId, OWNER_A, "todo", "todo-1", ""));
        assertFalse(ScheduleWidgetStore.completionActionMatches(actionId, OWNER_B, "todo", "todo-1", ""));
        assertFalse(ScheduleWidgetStore.completionActionMatches("", OWNER_A, "todo", "todo-1", ""));
    }

    @Test
    public void sourceAbsenceObservationSurvivesLaterStaleSnapshots() {
        assertFalse(ScheduleWidgetStore.nextSourceAbsentObserved(false, true));
        assertTrue(ScheduleWidgetStore.nextSourceAbsentObserved(false, false));
        assertTrue(ScheduleWidgetStore.nextSourceAbsentObserved(true, true));
    }

    @Test
    public void acknowledgedActionOnlyNeedsTombstoneBeforeSourceCatchesUp() {
        assertTrue(ScheduleWidgetStore.needsHiddenAfterAcknowledgement(false));
        assertFalse(ScheduleWidgetStore.needsHiddenAfterAcknowledgement(true));
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index++) result.append(value);
        return result.toString();
    }
}
