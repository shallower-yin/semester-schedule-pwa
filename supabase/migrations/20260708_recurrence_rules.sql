-- 扩展事项重复规则：每天、工作日、每月同日、自定义每 N 天。

alter table public.events
  add column if not exists recurrence_interval integer not null default 1;

alter table public.events
  drop constraint if exists events_recurrence_type_check;

alter table public.events
  add constraint events_recurrence_type_check
  check (recurrence_type in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'interval'));

alter table public.events
  drop constraint if exists events_recurrence_interval_check;

alter table public.events
  add constraint events_recurrence_interval_check
  check (recurrence_interval between 1 and 366);

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
        (
          occurrence.value::date + coalesce(event.start_time, time '09:00')
        ) at time zone event.timezone
      ) - make_interval(mins => event.reminder_minutes_before) as source_reminder_at
    from public.events as event
    cross join lateral generate_series(
      event.start_date::timestamp,
      (
        case
          when event.recurrence_type = 'none' then event.end_date
          else coalesce(event.recurrence_until, event.start_date)
        end
      )::timestamp,
      interval '1 day'
    ) as occurrence(value)
    where event.reminder_enabled
      and event.deleted_at is null
      and (
        event.recurrence_type = 'none'
        or event.recurrence_type = 'daily'
        or (event.recurrence_type = 'weekdays' and extract(isodow from occurrence.value)::integer between 1 and 5)
        or (event.recurrence_type = 'weekly' and extract(isodow from occurrence.value)::integer = extract(isodow from event.start_date)::integer)
        or (event.recurrence_type = 'monthly' and extract(day from occurrence.value)::integer = extract(day from event.start_date)::integer)
        or (event.recurrence_type = 'interval' and ((occurrence.value::date - event.start_date) % greatest(event.recurrence_interval, 1)) = 0)
      )
  ),
  anniversary_occurrences as (
    select
      'anniversary'::text as source_type,
      null::uuid as source_event_id,
      anniversary.id as source_anniversary_id,
      anniversary.user_id as source_user_id,
      anniversary.title as source_title,
      null::time as source_start_time,
      anniversary.kind as source_anniversary_kind,
      occurrence.occurrence_date as source_occurrence_date,
      (
        (
          occurrence.occurrence_date + anniversary.reminder_time
        ) at time zone anniversary.timezone
      ) - make_interval(days => anniversary.reminder_days_before) as source_reminder_at
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
    select *
    from reminder_occurrences
    where source_reminder_at <= now()
      and source_reminder_at > now() - interval '15 minutes'
  ),
  claimed as (
    insert into public.reminder_deliveries (
      id, user_id, event_id, anniversary_id, occurrence_date, reminder_at, claimed_at, status
    )
    select
      gen_random_uuid(),
      due.source_user_id,
      due.source_event_id,
      due.source_anniversary_id,
      due.source_occurrence_date,
      due.source_reminder_at,
      now(),
      'claimed'
    from due
    on conflict do nothing
    returning
      reminder_deliveries.id,
      reminder_deliveries.user_id,
      reminder_deliveries.event_id,
      reminder_deliveries.anniversary_id,
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
  left join public.events as event on event.id = claimed.event_id
  left join public.anniversaries as anniversary on anniversary.id = claimed.anniversary_id
  join public.push_subscriptions as subscription
    on subscription.user_id = claimed.user_id
    and subscription.deleted_at is null;
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon;
