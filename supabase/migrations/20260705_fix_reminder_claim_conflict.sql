-- 修复提醒领取函数中 RETURNS TABLE 输出参数与 ON CONFLICT 列名的歧义。
-- 仅替换函数定义，不修改业务表中的任何数据。

drop function if exists public.claim_due_reminders(text);

create function public.claim_due_reminders(dispatcher_token text)
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

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon;
