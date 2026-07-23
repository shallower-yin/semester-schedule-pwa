-- Deliver health movement reminders through the same minute dispatcher used by schedule Web Push.
-- A separate delivery table keeps the existing event/anniversary contract backward compatible.

create table if not exists public.health_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  reminder_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  status text not null default 'claimed' check (status in ('claimed', 'delivered')),
  error_message text,
  unique (profile_id, reminder_at)
);

alter table public.health_reminder_deliveries enable row level security;
drop policy if exists "Users read own health reminder deliveries" on public.health_reminder_deliveries;
create policy "Users read own health reminder deliveries"
on public.health_reminder_deliveries
for select
to authenticated
using ((select auth.uid()) = user_id);
revoke all on public.health_reminder_deliveries from anon;
grant select on public.health_reminder_deliveries to authenticated;

create or replace function public.next_health_reminder_at(
  anchor timestamptz,
  interval_minutes integer,
  start_time time,
  end_time time
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  candidate timestamp := (anchor at time zone 'Asia/Shanghai')
    + make_interval(mins => greatest(15, least(240, interval_minutes)));
  candidate_minute integer;
  start_minute integer := extract(hour from start_time)::integer * 60 + extract(minute from start_time)::integer;
  end_minute integer := extract(hour from end_time)::integer * 60 + extract(minute from end_time)::integer;
begin
  candidate_minute := extract(hour from candidate)::integer * 60 + extract(minute from candidate)::integer;
  if (
    start_minute <= end_minute
    and candidate_minute between start_minute and end_minute
  ) or (
    start_minute > end_minute
    and (candidate_minute >= start_minute or candidate_minute <= end_minute)
  ) then
    return candidate at time zone 'Asia/Shanghai';
  end if;

  if start_minute <= end_minute and candidate_minute > end_minute then
    candidate := candidate + interval '1 day';
  end if;
  candidate := candidate::date + start_time;
  return candidate at time zone 'Asia/Shanghai';
end;
$$;

create or replace function public.claim_due_health_reminders(dispatcher_token text)
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
  with recursive profiles as (
    select
      profile.id,
      profile.user_id,
      profile.movement_interval_minutes,
      profile.reminder_start_time,
      profile.reminder_end_time,
      greatest(
        profile.updated_at,
        coalesce((
          select max(log.logged_at)
          from public.health_logs log
          where log.user_id = profile.user_id
            and log.kind = 'movement'
            and log.deleted_at is null
        ), '-infinity'::timestamptz),
        (
          date_trunc('day', now() at time zone 'Asia/Shanghai') - interval '1 day'
        ) at time zone 'Asia/Shanghai'
      ) as baseline
    from public.health_profiles profile
    where profile.movement_reminder_enabled
      and profile.deleted_at is null
  ),
  slots as (
    select
      profile.id as profile_id,
      profile.user_id,
      profile.movement_interval_minutes,
      profile.reminder_start_time,
      profile.reminder_end_time,
      public.next_health_reminder_at(
        profile.baseline,
        profile.movement_interval_minutes,
        profile.reminder_start_time,
        profile.reminder_end_time
      ) as reminder_at,
      1 as depth
    from profiles profile
    union all
    select
      slot.profile_id,
      slot.user_id,
      slot.movement_interval_minutes,
      slot.reminder_start_time,
      slot.reminder_end_time,
      public.next_health_reminder_at(
        slot.reminder_at,
        slot.movement_interval_minutes,
        slot.reminder_start_time,
        slot.reminder_end_time
      ),
      slot.depth + 1
    from slots slot
    where slot.reminder_at <= now()
      and slot.depth < 256
  ),
  due as (
    select distinct on (slot.profile_id, slot.reminder_at)
      slot.profile_id,
      slot.user_id,
      slot.reminder_at
    from slots slot
    where slot.reminder_at <= now()
      and slot.reminder_at > now() - interval '15 minutes'
      and exists (
        select 1
        from public.push_subscriptions subscription
        where subscription.user_id = slot.user_id
          and subscription.deleted_at is null
      )
    order by slot.profile_id, slot.reminder_at
  ),
  claimed as (
    insert into public.health_reminder_deliveries (
      id, user_id, profile_id, reminder_at, claimed_at, status
    )
    select gen_random_uuid(), due.user_id, due.profile_id, due.reminder_at, now(), 'claimed'
    from due
    on conflict do nothing
    returning
      health_reminder_deliveries.id,
      health_reminder_deliveries.user_id,
      health_reminder_deliveries.profile_id,
      health_reminder_deliveries.reminder_at
  )
  select
    claimed.id,
    'health'::text,
    claimed.profile_id,
    null::uuid,
    null::uuid,
    claimed.user_id,
    '起来活动一下'::text,
    (claimed.reminder_at at time zone 'Asia/Shanghai')::date,
    (claimed.reminder_at at time zone 'Asia/Shanghai')::time,
    null::text,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth
  from claimed
  join public.push_subscriptions subscription
    on subscription.user_id = claimed.user_id
    and subscription.deleted_at is null;
end;
$$;

create or replace function public.complete_health_reminder_delivery(
  dispatcher_token text,
  target_delivery_id uuid,
  was_successful boolean,
  failure_message text default null,
  expired_endpoints text[] default array[]::text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if encode(digest(dispatcher_token, 'sha256'), 'hex') <> '68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7' then
    raise exception 'invalid dispatcher token' using errcode = '42501';
  end if;

  if was_successful then
    update public.health_reminder_deliveries
    set status = 'delivered', delivered_at = now(), error_message = failure_message
    where id = target_delivery_id;
  else
    delete from public.health_reminder_deliveries where id = target_delivery_id;
  end if;

  update public.push_subscriptions
  set deleted_at = now(), updated_at = now()
  where endpoint = any(expired_endpoints);
end;
$$;

revoke all on function public.next_health_reminder_at(timestamptz, integer, time, time) from public;
revoke all on function public.claim_due_health_reminders(text) from public;
revoke all on function public.complete_health_reminder_delivery(text, uuid, boolean, text, text[]) from public;
grant execute on function public.claim_due_health_reminders(text) to anon;
grant execute on function public.complete_health_reminder_delivery(text, uuid, boolean, text, text[]) to anon;
