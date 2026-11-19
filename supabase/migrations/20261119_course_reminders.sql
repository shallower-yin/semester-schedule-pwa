-- Course preferences are additive; legacy courses keep reminders off.
alter table public.courses
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_minutes_before integer not null default 10;

alter table public.courses drop constraint if exists courses_reminder_minutes_before_check;
alter table public.courses add constraint courses_reminder_minutes_before_check
  check (reminder_minutes_before between 0 and 10080);

alter table public.reminder_deliveries add column if not exists course_schedule_id uuid;
alter table public.reminder_deliveries drop constraint if exists reminder_deliveries_course_schedule_owner_fkey;
alter table public.reminder_deliveries add constraint reminder_deliveries_course_schedule_owner_fkey
  foreign key (course_schedule_id, user_id) references public.course_schedules(id, user_id) on delete cascade;
alter table public.reminder_deliveries drop constraint if exists reminder_deliveries_single_source_check;
alter table public.reminder_deliveries add constraint reminder_deliveries_single_source_check
  check (num_nonnulls(event_id, anniversary_id, todo_id, course_schedule_id) = 1);

create unique index if not exists reminder_deliveries_course_unique_idx
  on public.reminder_deliveries (course_schedule_id, occurrence_date, reminder_at)
  where course_schedule_id is not null;

-- Keep the existing event/todo RPC return type stable during overlapping deploys.
create or replace function public.claim_due_course_reminders(dispatcher_token text)
returns table (
  delivery_id uuid,
  source_type text,
  source_id uuid,
  course_schedule_id uuid,
  user_id uuid,
  title text,
  occurrence_date date,
  start_time time,
  all_day boolean,
  location text,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if encode(digest(dispatcher_token, 'sha256'), 'hex') is distinct from '68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7' then
    raise exception 'invalid dispatcher token' using errcode = '42501';
  end if;

  return query
  with occurrences as (
    select
      schedule.id as schedule_id,
      course.id as course_id,
      course.user_id as owner_id,
      course.name as course_name,
      course.classroom,
      occurrence.value as class_date,
      period.start_time as class_time,
      ((occurrence.value + period.start_time) at time zone 'Asia/Shanghai')
        - make_interval(mins => course.reminder_minutes_before) as reminder_at
    from public.course_schedules schedule
    join public.courses course on course.id = schedule.course_id and course.user_id = schedule.user_id
    join public.semesters semester on semester.id = course.semester_id and semester.user_id = course.user_id
    cross join lateral (select distinct unnest(schedule.weeks) as value) teaching_week
    cross join lateral (
      select date_trunc('week', semester.start_date::timestamp)::date
        + (teaching_week.value - 1) * 7 + schedule.weekday - 1 as value
    ) occurrence
    cross join lateral (
      select p.start_time from public.class_periods p
      where p.semester_id = semester.id and p.user_id = course.user_id
        and p.weekday = schedule.weekday and p.period_number = schedule.start_period
        and p.kind <> 'break' and p.deleted_at is null
      order by p.sort_order, p.id limit 1
    ) period
    where course.reminder_enabled and course.deleted_at is null
      and semester.deleted_at is null and schedule.deleted_at is null
      and teaching_week.value between 1 and semester.total_weeks
      and occurrence.value >= semester.start_date
      and not exists (
        select 1 from public.course_cancellations cancellation
        where cancellation.course_schedule_id = schedule.id and cancellation.user_id = course.user_id
          and cancellation.occurrence_date = occurrence.value and cancellation.deleted_at is null
      )
      and exists (
        select 1 from public.push_subscriptions subscription
        where subscription.user_id = course.user_id and subscription.deleted_at is null
      )
  ), due as (
    select * from occurrences
    where reminder_at <= now() and reminder_at > now() - interval '15 minutes'
  ), claimed as (
    insert into public.reminder_deliveries (
      id, user_id, course_schedule_id, occurrence_date, reminder_at, claimed_at, status
    )
    select gen_random_uuid(), owner_id, schedule_id, class_date, due.reminder_at, now(), 'claimed'
    from due on conflict do nothing
    returning reminder_deliveries.id, reminder_deliveries.course_schedule_id, reminder_deliveries.occurrence_date
  )
  select claimed.id, 'course'::text, due.course_id, claimed.course_schedule_id, due.owner_id,
    due.course_name, due.class_date, due.class_time, false, due.classroom,
    subscription.endpoint, subscription.p256dh, subscription.auth
  from claimed
  join due on due.schedule_id = claimed.course_schedule_id and due.class_date = claimed.occurrence_date
  join public.push_subscriptions subscription on subscription.user_id = due.owner_id and subscription.deleted_at is null;
end;
$$;

revoke all on function public.claim_due_course_reminders(text) from public;
grant execute on function public.claim_due_course_reminders(text) to anon;
