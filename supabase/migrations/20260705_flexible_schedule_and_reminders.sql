-- 灵活时间块、事项提醒和 Web Push 后台通知迁移
-- 可重复执行；不会删除现有课程、事项或用户数据。

alter table public.class_periods
  add column if not exists kind text not null default 'period',
  add column if not exists sort_order integer;

alter table public.class_periods drop constraint if exists class_periods_period_number_check;
alter table public.class_periods drop constraint if exists class_periods_kind_check;
alter table public.class_periods
  add constraint class_periods_kind_check check (kind in ('period', 'break'));

alter table public.course_schedules drop constraint if exists course_schedules_start_period_check;
alter table public.course_schedules drop constraint if exists course_schedules_end_period_check;
alter table public.course_schedules
  add constraint course_schedules_start_period_check check (start_period > 0),
  add constraint course_schedules_end_period_check check (end_period > 0);

update public.class_periods
set
  kind = coalesce(kind, 'period'),
  sort_order = case
    when period_number <= 4 then period_number
    else period_number + 1
  end
where sort_order is null;

insert into public.class_periods (
  id, user_id, created_at, updated_at, deleted_at, version, device_id,
  semester_id, weekday, period_number, kind, sort_order, name, start_time, end_time
)
select
  gen_random_uuid(), semester.user_id, now(), now(), null, 1, semester.device_id,
  semester.id, weekday.value, 0, 'break', 5, '午休', time '12:00', time '13:30'
from public.semesters as semester
cross join generate_series(1, 7) as weekday(value)
where not exists (
  select 1
  from public.class_periods as existing
  where existing.semester_id = semester.id
    and existing.user_id = semester.user_id
    and existing.weekday = weekday.value
    and existing.kind = 'break'
    and existing.deleted_at is null
);

alter table public.class_periods alter column sort_order set not null;

alter table public.events
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_minutes_before integer not null default 10,
  add column if not exists timezone text not null default 'Asia/Shanghai';

alter table public.events drop constraint if exists events_reminder_minutes_check;
alter table public.events
  add constraint events_reminder_minutes_check
  check (reminder_minutes_before between 0 and 10080);

alter table public.event_occurrence_states
  add column if not exists reminder_sent_at timestamptz;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_id uuid not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
on public.push_subscriptions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.register_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_device_id uuid,
  target_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (
    id, user_id, endpoint, p256dh, auth, device_id, user_agent, created_at, updated_at, deleted_at
  )
  values (
    gen_random_uuid(), current_user_id, target_endpoint, target_p256dh, target_auth,
    target_device_id, target_user_agent, now(), now(), null
  )
  on conflict (endpoint) do update
  set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    device_id = excluded.device_id,
    user_agent = excluded.user_agent,
    updated_at = now(),
    deleted_at = null;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, uuid, text) from public;
grant execute on function public.register_push_subscription(text, text, text, uuid, text) to authenticated;

create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  reminder_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  status text not null default 'claimed' check (status in ('claimed', 'delivered', 'failed')),
  error_message text,
  unique (event_id, occurrence_date, reminder_at)
);

alter table public.reminder_deliveries enable row level security;
drop policy if exists "Users read own reminder deliveries" on public.reminder_deliveries;
create policy "Users read own reminder deliveries"
on public.reminder_deliveries
for select
to authenticated
using ((select auth.uid()) = user_id);
revoke all on public.reminder_deliveries from anon;
grant select on public.reminder_deliveries to authenticated;

create or replace function public.claim_due_reminders(dispatcher_token text)
returns table (
  delivery_id uuid,
  event_id uuid,
  user_id uuid,
  title text,
  occurrence_date date,
  start_time time,
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
  with reminder_occurrences as (
    select
      event.id as source_event_id,
      event.user_id as source_user_id,
      event.title as source_title,
      event.start_time as source_start_time,
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
          else event.start_date
        end
      )::timestamp,
      case when event.recurrence_type = 'weekly' then interval '7 days' else interval '100 years' end
    ) as occurrence(value)
    where event.reminder_enabled
      and event.deleted_at is null
  ),
  due as (
    select *
    from reminder_occurrences
    where source_reminder_at <= now()
      and source_reminder_at > now() - interval '15 minutes'
  ),
  claimed as (
    insert into public.reminder_deliveries (
      id, user_id, event_id, occurrence_date, reminder_at, claimed_at, status
    )
    select
      gen_random_uuid(),
      due.source_user_id,
      due.source_event_id,
      due.source_occurrence_date,
      due.source_reminder_at,
      now(),
      'claimed'
    from due
    on conflict on constraint reminder_deliveries_event_id_occurrence_date_reminder_at_key do nothing
    returning
      reminder_deliveries.id,
      reminder_deliveries.user_id,
      reminder_deliveries.event_id,
      reminder_deliveries.occurrence_date
  )
  select
    claimed.id,
    event.id,
    event.user_id,
    event.title,
    claimed.occurrence_date,
    event.start_time,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth
  from claimed
  join public.events as event on event.id = claimed.event_id
  join public.push_subscriptions as subscription
    on subscription.user_id = claimed.user_id
    and subscription.deleted_at is null;
end;
$$;

create or replace function public.complete_reminder_delivery(
  dispatcher_token text,
  target_delivery_id uuid,
  was_successful boolean,
  failure_message text default null,
  expired_endpoints text[] default array[]::text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if encode(digest(dispatcher_token, 'sha256'), 'hex') <> '68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7' then
    raise exception 'invalid dispatcher token' using errcode = '42501';
  end if;

  update public.reminder_deliveries
  set
    status = case when was_successful then 'delivered' else 'failed' end,
    delivered_at = case when was_successful then now() else null end,
    error_message = failure_message
  where id = target_delivery_id;

  update public.push_subscriptions
  set deleted_at = now(), updated_at = now()
  where endpoint = any(expired_endpoints);
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
revoke all on function public.complete_reminder_delivery(text, uuid, boolean, text, text[]) from public;
grant execute on function public.claim_due_reminders(text) to anon;
grant execute on function public.complete_reminder_delivery(text, uuid, boolean, text, text[]) to anon;
