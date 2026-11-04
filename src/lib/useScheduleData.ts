import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../db";
import { uniqueCategoriesByName } from "./categories";
import { currentLiveQueryValue, scopedLiveQueryValue } from "./liveQueryScope";

interface ScheduleDataInput {
  ownerId: string;
  authReady: boolean;
}

/** Keep retained Dexie results scoped to the current owner and semester. */
export function useScheduleData({ ownerId, authReady }: ScheduleDataInput) {
  const ownerQueryScope = ownerId;
  const semesterResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      ownerQueryScope,
      (await db.semesters.filter((item) => item.user_id === ownerId && item.is_current && !item.deleted_at).first()) ?? null
    ),
    [ownerQueryScope]
  );
  const semesterQuery = currentLiveQueryValue(semesterResult, ownerQueryScope);
  const semester = semesterQuery ?? null;
  const semestersResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      ownerQueryScope,
      await db.semesters.filter((item) => item.user_id === ownerId && !item.deleted_at).reverse().sortBy("start_date")
    ),
    [ownerQueryScope]
  );
  const semestersQuery = currentLiveQueryValue(semestersResult, ownerQueryScope);
  const semesters = semestersQuery ?? [];
  const semesterDataScope = JSON.stringify([ownerId, semester?.id ?? null]);
  const coursesResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      semesterDataScope,
      semester
        ? await db.courses.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()
        : []
    ),
    [semesterDataScope]
  );
  const coursesQuery = currentLiveQueryValue(coursesResult, semesterDataScope);
  const courses = coursesQuery ?? [];
  const schedulesDataScope = JSON.stringify([ownerId, courses.map((course) => course.id).sort()]);
  const schedulesResult = useLiveQuery(
    async () => {
      if (!courses.length) return scopedLiveQueryValue(schedulesDataScope, []);
      const courseIds = new Set(courses.map((course) => course.id));
      const value = await db.courseSchedules.filter((item) => item.user_id === ownerId && courseIds.has(item.course_id) && !item.deleted_at).toArray();
      return scopedLiveQueryValue(schedulesDataScope, value);
    },
    [schedulesDataScope]
  );
  const schedulesQuery = currentLiveQueryValue(schedulesResult, schedulesDataScope);
  const schedules = schedulesQuery ?? [];
  const cancellationsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.courseCancellations.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const cancellationsQuery = currentLiveQueryValue(cancellationsResult, ownerQueryScope);
  const cancellations = cancellationsQuery ?? [];
  const eventsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.events.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const eventsQuery = currentLiveQueryValue(eventsResult, ownerQueryScope);
  const events = eventsQuery ?? [];
  const categoriesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.categories.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const categoriesQuery = currentLiveQueryValue(categoriesResult, ownerQueryScope);
  const categories = useMemo(() => uniqueCategoriesByName(categoriesQuery ?? []), [categoriesQuery]);
  const occurrenceStatesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.eventOccurrenceStates.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const occurrenceStatesQuery = currentLiveQueryValue(occurrenceStatesResult, ownerQueryScope);
  const occurrenceStates = occurrenceStatesQuery ?? [];
  const anniversariesResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.anniversaries.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const anniversariesQuery = currentLiveQueryValue(anniversariesResult, ownerQueryScope);
  const anniversaries = anniversariesQuery ?? [];
  const memosResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.memos.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const memosQuery = currentLiveQueryValue(memosResult, ownerQueryScope);
  const memos = memosQuery ?? [];
  const todosResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.todos.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const todosQuery = currentLiveQueryValue(todosResult, ownerQueryScope);
  const todos = todosQuery ?? [];
  const focusSessionsResult = useLiveQuery(
    async () => scopedLiveQueryValue(ownerQueryScope, await db.focusSessions.filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()),
    [ownerQueryScope]
  );
  const focusSessionsQuery = currentLiveQueryValue(focusSessionsResult, ownerQueryScope);
  const focusSessions = focusSessionsQuery ?? [];
  const periodsResult = useLiveQuery(
    async () => scopedLiveQueryValue(
      semesterDataScope,
      semester
        ? await db.classPeriods.where("semester_id").equals(semester.id).filter((item) => item.user_id === ownerId && !item.deleted_at).toArray()
        : []
    ),
    [semesterDataScope]
  );
  const periodsQuery = currentLiveQueryValue(periodsResult, semesterDataScope);
  const periods = periodsQuery ?? [];

  const widgetDataReady = authReady
    && semesterQuery !== undefined
    && semestersQuery !== undefined
    && coursesQuery !== undefined
    && schedulesQuery !== undefined
    && cancellationsQuery !== undefined
    && eventsQuery !== undefined
    && categoriesQuery !== undefined
    && occurrenceStatesQuery !== undefined
    && todosQuery !== undefined
    && periodsQuery !== undefined
    && focusSessionsQuery !== undefined;

  return {
    semesterQuery, eventsQuery, anniversariesQuery, todosQuery,
    semester, semesters, courses, schedules, cancellations, events, categories,
    occurrenceStates, anniversaries, memos, todos, focusSessions, periods,
    widgetDataReady
  };
}
