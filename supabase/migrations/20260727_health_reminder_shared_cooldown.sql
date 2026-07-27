-- Share the last delivered health movement reminder across devices so browser local checks,
-- Web Push, and Android rescheduling do not race into short-interval duplicate reminders.

alter table public.health_profiles
  add column if not exists last_movement_reminder_at timestamptz;

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
        coalesce(profile.last_movement_reminder_at, '-infinity'::timestamptz),
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
declare
  delivered_profile_id uuid;
  delivered_reminder_at timestamptz;
begin
  if encode(digest(dispatcher_token, 'sha256'), 'hex') <> '68e9790b77b3168da715f915a3925664b67b66b23ab0dfb3fe301d1d84da91d7' then
    raise exception 'invalid dispatcher token' using errcode = '42501';
  end if;

  if was_successful then
    update public.health_reminder_deliveries
    set status = 'delivered', delivered_at = now(), error_message = failure_message
    where id = target_delivery_id
    returning profile_id, reminder_at into delivered_profile_id, delivered_reminder_at;

    if delivered_profile_id is not null then
      update public.health_profiles
      set last_movement_reminder_at = greatest(
            coalesce(last_movement_reminder_at, '-infinity'::timestamptz),
            delivered_reminder_at
          ),
          updated_at = now()
      where id = delivered_profile_id;
    end if;
  else
    delete from public.health_reminder_deliveries where id = target_delivery_id;
  end if;

  update public.push_subscriptions
  set deleted_at = now(), updated_at = now()
  where endpoint = any(expired_endpoints);
end;
$$;

revoke all on function public.claim_due_health_reminders(text) from public;
revoke all on function public.complete_health_reminder_delivery(text, uuid, boolean, text, text[]) from public;
grant execute on function public.claim_due_health_reminders(text) to anon;
grant execute on function public.complete_health_reminder_delivery(text, uuid, boolean, text, text[]) to anon;
