-- Keep recurring health reminders on wall-clock slots anchored to the configured
-- window start. Delivery latency, profile sync, and movement logs must not shift
-- every later reminder. Slots more than three minutes late are intentionally skipped.

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
  local_anchor timestamp := anchor at time zone 'Asia/Shanghai';
  local_date date := local_anchor::date;
  safe_interval integer := greatest(15, least(240, interval_minutes));
  window_start timestamp;
  window_end timestamp;
  candidate timestamp;
  elapsed_minutes bigint;
begin
  if start_time <= end_time then
    window_start := local_date + start_time;
    window_end := local_date + end_time;
    if local_anchor < window_start then
      return window_start at time zone 'Asia/Shanghai';
    end if;
  elsif local_anchor::time > end_time and local_anchor::time < start_time then
    window_start := local_date + start_time;
    return window_start at time zone 'Asia/Shanghai';
  elsif local_anchor::time <= end_time then
    window_start := (local_date - 1) + start_time;
    window_end := local_date + end_time;
  else
    window_start := local_date + start_time;
    window_end := (local_date + 1) + end_time;
  end if;

  elapsed_minutes := floor(extract(epoch from (local_anchor - window_start)) / 60)::bigint;
  candidate := window_start
    + make_interval(mins => (((elapsed_minutes / safe_interval) + 1) * safe_interval)::integer);
  if candidate <= window_end then
    return candidate at time zone 'Asia/Shanghai';
  end if;
  return (window_start + interval '1 day') at time zone 'Asia/Shanghai';
end;
$$;

create or replace function public.health_reminder_slot_at_or_before(
  reference_at timestamptz,
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
  local_reference timestamp := reference_at at time zone 'Asia/Shanghai';
  local_date date := local_reference::date;
  safe_interval integer := greatest(15, least(240, interval_minutes));
  window_start timestamp;
  window_end timestamp;
  candidate timestamp;
  elapsed_minutes bigint;
  window_minutes bigint;
begin
  if start_time <= end_time then
    if local_reference::time >= start_time then
      window_start := local_date + start_time;
      window_end := local_date + end_time;
    else
      window_start := (local_date - 1) + start_time;
      window_end := (local_date - 1) + end_time;
    end if;
  elsif local_reference::time >= start_time then
    window_start := local_date + start_time;
    window_end := (local_date + 1) + end_time;
  elsif local_reference::time <= end_time then
    window_start := (local_date - 1) + start_time;
    window_end := local_date + end_time;
  else
    window_start := (local_date - 1) + start_time;
    window_end := local_date + end_time;
  end if;

  elapsed_minutes := floor(extract(epoch from (least(local_reference, window_end) - window_start)) / 60)::bigint;
  candidate := window_start
    + make_interval(mins => ((elapsed_minutes / safe_interval) * safe_interval)::integer);
  if candidate <= window_end then
    return candidate at time zone 'Asia/Shanghai';
  end if;
  window_minutes := floor(extract(epoch from (window_end - window_start)) / 60)::bigint;
  return (
    window_start + make_interval(mins => ((window_minutes / safe_interval) * safe_interval)::integer)
  ) at time zone 'Asia/Shanghai';
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
  with profiles as (
    select
      profile.id,
      profile.user_id,
      profile.updated_at,
      profile.last_movement_reminder_at,
      profile.movement_interval_minutes,
      profile.reminder_start_time,
      profile.reminder_end_time
    from public.health_profiles profile
    where profile.movement_reminder_enabled
      and profile.deleted_at is null
  ),
  due as (
    select
      profile.id as profile_id,
      profile.user_id,
      profile.updated_at,
      profile.last_movement_reminder_at,
      public.health_reminder_slot_at_or_before(
        now(),
        profile.movement_interval_minutes,
        profile.reminder_start_time,
        profile.reminder_end_time
      ) as reminder_at
    from profiles profile
  ),
  eligible as (
    select due.profile_id, due.user_id, due.reminder_at
    from due
    where due.reminder_at <= now()
      and due.reminder_at >= now() - interval '3 minutes'
      and due.reminder_at >= due.updated_at
      and (due.last_movement_reminder_at is null or due.reminder_at > due.last_movement_reminder_at)
      and exists (
        select 1
        from public.push_subscriptions subscription
        where subscription.user_id = due.user_id
          and subscription.deleted_at is null
      )
  ),
  claimed as (
    insert into public.health_reminder_deliveries (
      id, user_id, profile_id, reminder_at, claimed_at, status
    )
    select gen_random_uuid(), eligible.user_id, eligible.profile_id, eligible.reminder_at, now(), 'claimed'
    from eligible
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

revoke all on function public.next_health_reminder_at(timestamptz, integer, time, time) from public;
revoke all on function public.health_reminder_slot_at_or_before(timestamptz, integer, time, time) from public;
revoke all on function public.claim_due_health_reminders(text) from public;
grant execute on function public.claim_due_health_reminders(text) to anon;
