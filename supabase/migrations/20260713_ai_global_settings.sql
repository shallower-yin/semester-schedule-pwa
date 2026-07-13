create table if not exists public.ai_assistant_settings (
  id boolean primary key default true check (id),
  enabled_for_all boolean not null default false,
  daily_limit integer not null default 20 check (daily_limit between 1 and 100000),
  weekly_limit integer not null default 100 check (weekly_limit between 1 and 1000000),
  updated_at timestamptz not null default now()
);

insert into public.ai_assistant_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.ai_assistant_settings enable row level security;
revoke all on public.ai_assistant_settings from anon, authenticated;
grant select, insert, update on public.ai_assistant_settings to service_role;

create or replace function public.admin_get_ai_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;

  select to_jsonb(settings)
  into result
  from public.ai_assistant_settings settings
  where settings.id = true;
  return result;
end;
$$;

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_daily_limit integer,
  p_weekly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;
  if p_daily_limit < 1 or p_daily_limit > 100000 then
    raise exception '每日额度必须在 1 到 100000 之间。' using errcode = '22023';
  end if;
  if p_weekly_limit < p_daily_limit or p_weekly_limit > 1000000 then
    raise exception '每周额度不能低于每日额度，且不能超过 1000000。' using errcode = '22023';
  end if;

  insert into public.ai_assistant_settings as settings (
    id, enabled_for_all, daily_limit, weekly_limit, updated_at
  ) values (
    true, coalesce(p_enabled_for_all, false), p_daily_limit, p_weekly_limit, now()
  )
  on conflict (id) do update set
    enabled_for_all = excluded.enabled_for_all,
    daily_limit = excluded.daily_limit,
    weekly_limit = excluded.weekly_limit,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_get_ai_settings() from public;
revoke all on function public.admin_set_ai_settings(boolean, integer, integer) from public;
grant execute on function public.admin_get_ai_settings() to authenticated;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer) to authenticated;
