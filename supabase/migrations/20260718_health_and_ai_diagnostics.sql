create table if not exists public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  height_cm numeric(5, 1) check (height_cm is null or height_cm between 80 and 260),
  daily_water_goal_ml integer not null default 2000 check (daily_water_goal_ml between 250 and 10000),
  movement_reminder_enabled boolean not null default false,
  movement_interval_minutes integer not null default 60 check (movement_interval_minutes between 15 and 240),
  reminder_start_time time not null default '09:00',
  reminder_end_time time not null default '22:00',
  unique (id, user_id)
);

create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  kind text not null check (kind in ('water', 'movement', 'exercise', 'weight')),
  logged_at timestamptz not null,
  amount numeric(10, 2) not null check (amount > 0),
  unit text not null check (unit in ('ml', 'minute', 'rep', 'kg')),
  activity text,
  note text not null default '',
  unique (id, user_id)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['health_profiles', 'health_logs'] loop
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

create index if not exists health_logs_user_logged_idx
on public.health_logs (user_id, logged_at desc);

alter table public.ai_assistant_usage
  add column if not exists diagnostic_id uuid,
  add column if not exists diagnostic_details jsonb not null default '{}'::jsonb;

create index if not exists ai_assistant_usage_diagnostic_idx
on public.ai_assistant_usage (diagnostic_id)
where diagnostic_id is not null;

create or replace function public.admin_list_ai_error_logs(p_limit integer default 50)
returns table (
  requested_at timestamptz,
  user_id uuid,
  feature_key text,
  model text,
  diagnostic_id uuid,
  latency_ms integer,
  error text,
  diagnostic_details jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;
  return query
  select usage.requested_at, usage.user_id, usage.feature_key, usage.model,
    usage.diagnostic_id, usage.latency_ms, usage.error, usage.diagnostic_details
  from public.ai_assistant_usage usage
  where usage.status = 'error'
  order by usage.requested_at desc
  limit least(200, greatest(1, coalesce(p_limit, 50)));
end;
$$;

revoke all on function public.admin_list_ai_error_logs(integer) from public;
grant execute on function public.admin_list_ai_error_logs(integer) to authenticated;
