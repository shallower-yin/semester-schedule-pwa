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

create table if not exists public.rest_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  planned_seconds integer not null check (planned_seconds >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  completed boolean not null default false,
  interrupted boolean not null default false,
  unique (id, user_id)
);

alter table public.rest_sessions enable row level security;

drop policy if exists "Users manage own rows" on public.rest_sessions;
create policy "Users manage own rows"
on public.rest_sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists set_sync_metadata on public.rest_sessions;
create trigger set_sync_metadata
before insert or update on public.rest_sessions
for each row execute function public.apply_schedule_sync_metadata();

create index if not exists rest_sessions_user_sync_idx
on public.rest_sessions (user_id, server_updated_at);

revoke all on public.rest_sessions from anon;
grant select, insert, update, delete on public.rest_sessions to authenticated;
grant select, insert, update, delete on public.rest_sessions to service_role;
