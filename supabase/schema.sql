-- 日程计划表：Supabase PostgreSQL schema
-- 在 Supabase Dashboard -> SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  start_date date not null,
  total_weeks smallint not null check (total_weeks between 1 and 60),
  is_current boolean not null default false,
  unique (id, user_id)
);

create table if not exists public.class_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  semester_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  period_number smallint not null check (period_number between 1 and 24),
  name text not null check (char_length(name) between 1 and 50),
  start_time time not null,
  end_time time not null,
  unique (id, user_id),
  foreign key (semester_id, user_id) references public.semesters(id, user_id)
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  semester_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  teacher text not null default '',
  classroom text not null default '',
  color text not null default '#5b78df',
  note text not null default '',
  unique (id, user_id),
  foreign key (semester_id, user_id) references public.semesters(id, user_id)
);

create table if not exists public.course_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  course_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_period smallint not null check (start_period between 1 and 24),
  end_period smallint not null check (end_period between start_period and 24),
  weeks smallint[] not null check (coalesce(array_length(weeks, 1), 0) > 0),
  unique (id, user_id),
  foreign key (course_id, user_id) references public.courses(id, user_id)
);

create table if not exists public.course_cancellations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  course_schedule_id uuid not null,
  occurrence_date date not null,
  reason text not null default '',
  unique (id, user_id),
  unique (user_id, course_schedule_id, occurrence_date),
  foreign key (course_schedule_id, user_id) references public.course_schedules(id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 50),
  color text not null,
  icon text not null,
  unique (id, user_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  start_date date not null,
  start_time time,
  end_date date not null,
  end_time time,
  all_day boolean not null default false,
  category_id uuid,
  color text not null default '#e36b32',
  note text not null default '',
  recurrence_type text not null default 'none' check (recurrence_type in ('none', 'weekly')),
  recurrence_until date,
  unique (id, user_id)
);

create table if not exists public.event_occurrence_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  event_id uuid not null,
  occurrence_date date not null,
  completed boolean not null default false,
  unique (id, user_id),
  unique (user_id, event_id, occurrence_date),
  foreign key (event_id, user_id) references public.events(id, user_id)
);

create table if not exists public.memo_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  sort_order integer not null default 0,
  unique (id, user_id)
);

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  folder_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '',
  is_pinned boolean not null default false,
  unique (id, user_id),
  foreign key (folder_id, user_id) references public.memo_folders(id, user_id)
);

create table if not exists public.focus_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  pomodoro_minutes integer not null default 25 check (pomodoro_minutes between 1 and 240),
  short_break_minutes integer not null default 5 check (short_break_minutes between 1 and 120),
  countdown_minutes integer not null default 30 check (countdown_minutes between 1 and 720),
  daily_goal_minutes integer not null default 120 check (daily_goal_minutes between 1 and 1440),
  sound_enabled boolean not null default true,
  unique (id, user_id)
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  mode text not null check (mode in ('stopwatch', 'countdown', 'pomodoro')),
  task_title text not null default '',
  linked_event_id uuid,
  planned_seconds integer check (planned_seconds is null or planned_seconds >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  completed boolean not null default false,
  interrupted boolean not null default false,
  unique (id, user_id),
  foreign key (linked_event_id, user_id) references public.events(id, user_id)
);

create or replace function public.apply_schedule_sync_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return old;
    end if;
    new.created_at := old.created_at;
    new.version := greatest(coalesce(new.version, 1), old.version + 1);
  else
    new.version := greatest(coalesce(new.version, 1), 1);
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
  tables text[] := array[
    'semesters',
    'class_periods',
    'courses',
    'course_schedules',
    'course_cancellations',
    'categories',
    'events',
    'event_occurrence_states',
    'memo_folders',
    'memos',
    'focus_settings',
    'focus_sessions'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "Users manage own rows" on public.%I', table_name);
    execute format(
      'create policy "Users manage own rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format('drop trigger if exists set_sync_metadata on public.%I', table_name);
    execute format(
      'create trigger set_sync_metadata before insert or update on public.%I for each row execute function public.apply_schedule_sync_metadata()',
      table_name
    );
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', table_name || '_user_sync_idx', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end
$$;

grant usage on schema public to authenticated;
