-- 备忘录与专注功能迁移
-- 可重复执行；不会删除现有数据。

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

do $$
declare
  table_name text;
  tables text[] := array[
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
