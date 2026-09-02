-- Standalone todo records.  Keep this migration repeatable for the tracked
-- schema runner and compatible with clients which are still on the prior app.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  device_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  color text not null default '#cfeeff' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_pinned boolean not null default false,
  completed_at timestamptz,
  unique (id, user_id)
);

create index if not exists todos_user_active_sort_idx
on public.todos (user_id, is_pinned desc, sort_order asc, created_at asc)
where deleted_at is null;

create index if not exists todos_user_sync_idx
on public.todos (user_id, server_updated_at);

alter table public.todos enable row level security;

drop policy if exists "Users manage own rows" on public.todos;
create policy "Users manage own rows"
on public.todos
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists set_sync_metadata on public.todos;
create trigger set_sync_metadata
before insert or update on public.todos
for each row execute function public.apply_schedule_sync_metadata();

revoke all on public.todos from anon;
grant select, insert, update, delete on public.todos to authenticated;
grant select, insert, update, delete on public.todos to service_role;
