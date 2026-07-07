create table if not exists public.ai_assistant_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  role text not null default 'member' check (role in ('member', 'admin')),
  expires_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_assistant_access enable row level security;

create or replace function public.is_ai_assistant_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ai_assistant_access admin_access
    where admin_access.user_id = auth.uid()
      and admin_access.enabled
      and admin_access.role = 'admin'
      and (admin_access.expires_at is null or admin_access.expires_at > now())
  );
$$;

revoke all on function public.is_ai_assistant_admin() from public;
grant execute on function public.is_ai_assistant_admin() to authenticated;

drop policy if exists "Users read own AI access" on public.ai_assistant_access;
create policy "Users read own AI access"
on public.ai_assistant_access
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "AI admins read all access" on public.ai_assistant_access;
create policy "AI admins read all access"
on public.ai_assistant_access
for select
to authenticated
using (public.is_ai_assistant_admin());

drop policy if exists "AI admins manage access" on public.ai_assistant_access;
create policy "AI admins manage access"
on public.ai_assistant_access
for all
to authenticated
using (public.is_ai_assistant_admin())
with check (public.is_ai_assistant_admin());
