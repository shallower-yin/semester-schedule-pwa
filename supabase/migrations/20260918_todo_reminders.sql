-- Add one-shot reminders for standalone todos and include them in the shared
-- Web Push reminder claim path.

alter table public.todos
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists todos_user_due_reminders_idx
on public.todos (user_id, reminder_at)
where deleted_at is null
  and completed_at is null
  and reminder_enabled
  and reminder_at is not null
  and reminder_sent_at is null;

alter table public.reminder_deliveries
  add column if not exists todo_id uuid;

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_todo_id_fkey;
alter table public.reminder_deliveries
  add constraint reminder_deliveries_todo_id_fkey
  foreign key (todo_id) references public.todos(id) on delete cascade;

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_single_source_check;
alter table public.reminder_deliveries
  add constraint reminder_deliveries_single_source_check
  check (num_nonnulls(event_id, anniversary_id, todo_id) = 1);

create unique index if not exists reminder_deliveries_todo_unique_idx
on public.reminder_deliveries (todo_id, reminder_at)
where todo_id is not null;

drop function if exists public.claim_due_reminders(text);

create function public.claim_due_reminders(dispatcher_token text)
returns table (
  delivery_id uuid,
  source_type text,
  source_id uuid,
  event_id uuid,
  anniversary_id uuid,
  todo_id uuid,
  user_id uuid,
  title text,
  occurrence_date date,
  start_time time,
  all_day boolean,
  location text,
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
      null::uuid as source_todo_id,
      event.user_id as source_user_id,
      event.title as source_title,
      event.start_time as source_start_time,
      event.all_day as source_all_day,
      event.location as source_location,
      null::text as source_anniversary_kind,
      occurrence.value::date as source_occurrence_date,
      (
        ((occurrence.value::date + coalesce(event.start_time, time '09:00')) at time zone event.timezone)
        - make_interval(mins => event.reminder_minutes_before)
      ) as source_reminder_at
    from public.events as event
    cross join lateral generate_series(
      (
        case
          when event.recurrence_type = 'none' then event.start_date
          else greatest(event.start_date, (now() at time zone 'Asia/Shanghai')::date - 1)
        end
      )::timestamp,
      (
        case
          when event.recurrence_type = 'none' then event.start_date
          else least(
            coalesce(event.recurrence_until, (now() at time zone 'Asia/Shanghai')::date + 1),
            (now() at time zone 'Asia/Shanghai')::date + 1
          )
        end
      )::timestamp,
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
        or (
          event.recurrence_type = 'monthly'
          and extract(day from occurrence.value)::integer = least(
            extract(day from event.start_date)::integer,
            extract(day from (date_trunc('month', occurrence.value) + interval '1 month - 1 day'))::integer
          )
        )
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
      null::uuid,
      anniversary.user_id,
      anniversary.title,
      null::time,
      null::boolean,
      null::text,
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
  todo_occurrences as (
    select
      'todo'::text,
      null::uuid,
      null::uuid,
      todo.id,
      todo.user_id,
      todo.title,
      (todo.reminder_at at time zone 'Asia/Shanghai')::time,
      false::boolean,
      null::text,
      null::text,
      (todo.reminder_at at time zone 'Asia/Shanghai')::date,
      todo.reminder_at
    from public.todos as todo
    where todo.reminder_enabled
      and todo.reminder_at is not null
      and todo.reminder_sent_at is null
      and todo.completed_at is null
      and todo.deleted_at is null
  ),
  reminder_occurrences as (
    select * from event_occurrences
    union all
    select * from anniversary_occurrences
    union all
    select * from todo_occurrences
  ),
  due as (
    select * from reminder_occurrences
    where source_reminder_at <= now()
      and source_reminder_at > now() - interval '15 minutes'
  ),
  claimed as (
    insert into public.reminder_deliveries (
      id, user_id, event_id, anniversary_id, todo_id, occurrence_date, reminder_at, claimed_at, status
    )
    select
      gen_random_uuid(),
      source_user_id,
      source_event_id,
      source_anniversary_id,
      source_todo_id,
      source_occurrence_date,
      source_reminder_at,
      now(),
      'claimed'
    from due
    on conflict do nothing
    returning
      reminder_deliveries.id,
      reminder_deliveries.user_id,
      reminder_deliveries.event_id,
      reminder_deliveries.anniversary_id,
      reminder_deliveries.todo_id,
      reminder_deliveries.occurrence_date
  )
  select
    claimed.id,
    case
      when claimed.event_id is not null then 'event'
      when claimed.anniversary_id is not null then 'anniversary'
      else 'todo'
    end,
    coalesce(claimed.event_id, claimed.anniversary_id, claimed.todo_id),
    claimed.event_id,
    claimed.anniversary_id,
    claimed.todo_id,
    claimed.user_id,
    coalesce(event.title, anniversary.title, todo.title),
    claimed.occurrence_date,
    case
      when claimed.todo_id is not null then (todo.reminder_at at time zone 'Asia/Shanghai')::time
      else event.start_time
    end,
    case
      when claimed.todo_id is not null then false
      else event.all_day
    end,
    event.location,
    anniversary.kind,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth
  from claimed
  left join public.events event on event.id = claimed.event_id
  left join public.anniversaries anniversary on anniversary.id = claimed.anniversary_id
  left join public.todos todo on todo.id = claimed.todo_id
  join public.push_subscriptions subscription
    on subscription.user_id = claimed.user_id
   and subscription.deleted_at is null;
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon;
