alter table public.events
add column if not exists completed_at timestamptz;

-- Whole-item completion must suppress future cloud reminders without erasing
-- the user's reminder preference, so recreate the current claim function with
-- completed events excluded from its occurrence source.
drop function if exists public.claim_due_reminders(text);

create function public.claim_due_reminders(dispatcher_token text)
returns table (
  delivery_id uuid,
  source_type text,
  source_id uuid,
  event_id uuid,
  anniversary_id uuid,
  user_id uuid,
  title text,
  occurrence_date date,
  start_time time,
  anniversary_kind text,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if encode(digest(dispatcher_token, 'sha256'), 'hex') <> '68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7' then
    raise exception 'invalid dispatcher token' using errcode = '42501';
  end if;

  return query
  with event_occurrences as (
    select
      'event'::text as source_type,
      event.id as source_event_id,
      null::uuid as source_anniversary_id,
      event.user_id as source_user_id,
      event.title as source_title,
      event.start_time as source_start_time,
      null::text as source_anniversary_kind,
      occurrence.value::date as source_occurrence_date,
      (
        ((occurrence.value::date + coalesce(event.start_time, time '09:00')) at time zone event.timezone)
        - make_interval(mins => event.reminder_minutes_before)
      ) as source_reminder_at
    from public.events as event
    cross join lateral generate_series(
      event.start_date::timestamp,
      (case when event.recurrence_type = 'none' then event.end_date else coalesce(event.recurrence_until, event.start_date) end)::timestamp,
      interval '1 day'
    ) as occurrence(value)
    where event.reminder_enabled
      and event.completed_at is null
      and event.deleted_at is null
      and (
        event.recurrence_type = 'none'
        or event.recurrence_type = 'daily'
        or (event.recurrence_type = 'weekdays' and extract(isodow from occurrence.value)::integer between 1 and 5)
        or (event.recurrence_type = 'weekly' and extract(isodow from occurrence.value)::integer = extract(isodow from event.start_date)::integer)
        or (event.recurrence_type = 'monthly' and extract(day from occurrence.value)::integer = extract(day from event.start_date)::integer)
        or (event.recurrence_type = 'interval' and ((occurrence.value::date - event.start_date) % greatest(event.recurrence_interval, 1)) = 0)
      )
      and not exists (
        select 1
        from public.event_occurrence_states state
        where state.event_id = event.id
          and state.occurrence_date = occurrence.value::date
          and state.completed
          and state.deleted_at is null
      )
  ),
  anniversary_occurrences as (
    select
      'anniversary'::text,
      null::uuid,
      anniversary.id,
      anniversary.user_id,
      anniversary.title,
      null::time,
      anniversary.kind,
      occurrence.occurrence_date,
      (((occurrence.occurrence_date + anniversary.reminder_time) at time zone anniversary.timezone)
        - make_interval(days => anniversary.reminder_days_before))
    from public.anniversaries as anniversary
    cross join lateral (
      select public.anniversary_date_for_year(anniversary.date, year.value) as occurrence_date
      from generate_series(extract(year from now())::integer, extract(year from now())::integer + 2) as year(value)
    ) as occurrence
    where anniversary.reminder_enabled
      and anniversary.deleted_at is null
      and occurrence.occurrence_date >= anniversary.date
  ),
  reminder_occurrences as (
    select * from event_occurrences
    union all
    select * from anniversary_occurrences
  ),
  due as (
    select * from reminder_occurrences
    where source_reminder_at <= now()
      and source_reminder_at > now() - interval '15 minutes'
  ),
  claimed as (
    insert into public.reminder_deliveries (
      id, user_id, event_id, anniversary_id, occurrence_date, reminder_at, claimed_at, status
    )
    select gen_random_uuid(), source_user_id, source_event_id, source_anniversary_id,
      source_occurrence_date, source_reminder_at, now(), 'claimed'
    from due
    on conflict do nothing
    returning reminder_deliveries.id, reminder_deliveries.user_id,
      reminder_deliveries.event_id, reminder_deliveries.anniversary_id,
      reminder_deliveries.occurrence_date
  )
  select
    claimed.id,
    case when claimed.event_id is not null then 'event' else 'anniversary' end,
    coalesce(claimed.event_id, claimed.anniversary_id),
    claimed.event_id,
    claimed.anniversary_id,
    claimed.user_id,
    coalesce(event.title, anniversary.title),
    claimed.occurrence_date,
    event.start_time,
    anniversary.kind,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth
  from claimed
  left join public.events event on event.id = claimed.event_id
  left join public.anniversaries anniversary on anniversary.id = claimed.anniversary_id
  join public.push_subscriptions subscription
    on subscription.user_id = claimed.user_id and subscription.deleted_at is null;
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon;
