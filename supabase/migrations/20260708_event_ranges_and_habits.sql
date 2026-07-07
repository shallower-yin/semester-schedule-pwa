-- 事项日期范围与习惯功能迁移。
-- 可重复执行；不会删除现有事项、纪念日或提醒记录。

alter table public.events
  add column if not exists event_type text not null default 'event';

alter table public.events
  drop constraint if exists events_event_type_check;

alter table public.events
  add constraint events_event_type_check
  check (event_type in ('event', 'habit'));

create index if not exists events_user_type_idx
on public.events (user_id, event_type)
where deleted_at is null;

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
          when event.recurrence_type = 'weekly' then coalesce(event.recurrence_until, event.start_date)
          else event.end_date
        end
      )::timestamp,
      case when event.recurrence_type = 'weekly' then interval '7 days' else interval '1 day' end
    ) as occurrence(value)
    where event.reminder_enabled
      and event.deleted_at is null
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
