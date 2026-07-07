-- 纪念日、生日和节日功能迁移
-- 可重复执行；不会删除现有数据。

create table if not exists public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  kind text not null default 'anniversary' check (kind in ('anniversary', 'birthday', 'holiday')),
  title text not null check (char_length(title) between 1 and 200),
  date date not null,
  color text not null default '#d97706',
  note text not null default '',
  reminder_enabled boolean not null default false,
  reminder_days_before integer not null default 0 check (reminder_days_before between 0 and 366),
  reminder_time time not null default time '09:00',
  reminder_sent_for date,
  timezone text not null default 'Asia/Shanghai',
  unique (id, user_id)
);

alter table public.anniversaries enable row level security;
drop policy if exists "Users manage own rows" on public.anniversaries;
create policy "Users manage own rows"
on public.anniversaries
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists set_sync_metadata on public.anniversaries;
create trigger set_sync_metadata
before insert or update on public.anniversaries
for each row execute function public.apply_schedule_sync_metadata();

create index if not exists anniversaries_user_sync_idx on public.anniversaries (user_id, server_updated_at);
revoke all on public.anniversaries from anon;
grant select, insert, update, delete on public.anniversaries to authenticated;

alter table public.reminder_deliveries
  add column if not exists anniversary_id uuid;

alter table public.reminder_deliveries
  alter column event_id drop not null;

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_anniversary_id_fkey;
alter table public.reminder_deliveries
  add constraint reminder_deliveries_anniversary_id_fkey
  foreign key (anniversary_id) references public.anniversaries(id) on delete cascade;

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_single_source_check;
alter table public.reminder_deliveries
  add constraint reminder_deliveries_single_source_check
  check (num_nonnulls(event_id, anniversary_id) = 1);

create unique index if not exists reminder_deliveries_anniversary_unique_idx
on public.reminder_deliveries (anniversary_id, occurrence_date, reminder_at)
where anniversary_id is not null;

create or replace function public.anniversary_date_for_year(source_date date, target_year integer)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when extract(month from source_date)::integer = 2
      and extract(day from source_date)::integer = 29
      and not (
        target_year % 400 = 0
        or (target_year % 4 = 0 and target_year % 100 <> 0)
      )
    then make_date(target_year, 2, 28)
    else make_date(target_year, extract(month from source_date)::integer, extract(day from source_date)::integer)
  end;
$$;

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
          else event.start_date
        end
      )::timestamp,
      case when event.recurrence_type = 'weekly' then interval '7 days' else interval '100 years' end
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
