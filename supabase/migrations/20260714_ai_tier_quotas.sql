alter table public.ai_assistant_settings
  add column if not exists ordinary_daily_limit integer not null default 20,
  add column if not exists ordinary_weekly_limit integer not null default 100,
  add column if not exists member_daily_limit integer not null default 50,
  add column if not exists member_weekly_limit integer not null default 300;

update public.ai_assistant_settings
set
  ordinary_daily_limit = coalesce(daily_limit, ordinary_daily_limit, 20),
  ordinary_weekly_limit = greatest(
    coalesce(weekly_limit, ordinary_weekly_limit, 100),
    coalesce(daily_limit, ordinary_daily_limit, 20)
  ),
  member_daily_limit = coalesce(member_daily_limit, 50),
  member_weekly_limit = greatest(coalesce(member_weekly_limit, 300), coalesce(member_daily_limit, 50))
where id = true;

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_ordinary_daily_limit_check,
  drop constraint if exists ai_assistant_settings_ordinary_weekly_limit_check,
  drop constraint if exists ai_assistant_settings_member_daily_limit_check,
  drop constraint if exists ai_assistant_settings_member_weekly_limit_check;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_ordinary_daily_limit_check
    check (ordinary_daily_limit between 1 and 100000),
  add constraint ai_assistant_settings_ordinary_weekly_limit_check
    check (ordinary_weekly_limit between ordinary_daily_limit and 1000000),
  add constraint ai_assistant_settings_member_daily_limit_check
    check (member_daily_limit between 1 and 100000),
  add constraint ai_assistant_settings_member_weekly_limit_check
    check (member_weekly_limit between member_daily_limit and 1000000);

drop function if exists public.admin_set_ai_settings(boolean, integer, integer);

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_ordinary_daily_limit integer,
  p_ordinary_weekly_limit integer,
  p_member_daily_limit integer,
  p_member_weekly_limit integer
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
  if p_ordinary_daily_limit < 1 or p_ordinary_daily_limit > 100000 then
    raise exception '普通用户每日额度必须在 1 到 100000 之间。' using errcode = '22023';
  end if;
  if p_ordinary_weekly_limit < p_ordinary_daily_limit or p_ordinary_weekly_limit > 1000000 then
    raise exception '普通用户每周额度不能低于每日额度，且不能超过 1000000。' using errcode = '22023';
  end if;
  if p_member_daily_limit < 1 or p_member_daily_limit > 100000 then
    raise exception '会员每日额度必须在 1 到 100000 之间。' using errcode = '22023';
  end if;
  if p_member_weekly_limit < p_member_daily_limit or p_member_weekly_limit > 1000000 then
    raise exception '会员每周额度不能低于每日额度，且不能超过 1000000。' using errcode = '22023';
  end if;

  insert into public.ai_assistant_settings as settings (
    id, enabled_for_all, daily_limit, weekly_limit,
    ordinary_daily_limit, ordinary_weekly_limit,
    member_daily_limit, member_weekly_limit, updated_at
  ) values (
    true, coalesce(p_enabled_for_all, false),
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_member_daily_limit, p_member_weekly_limit, now()
  )
  on conflict (id) do update set
    enabled_for_all = excluded.enabled_for_all,
    daily_limit = excluded.daily_limit,
    weekly_limit = excluded.weekly_limit,
    ordinary_daily_limit = excluded.ordinary_daily_limit,
    ordinary_weekly_limit = excluded.ordinary_weekly_limit,
    member_daily_limit = excluded.member_daily_limit,
    member_weekly_limit = excluded.member_weekly_limit,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer) from public;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer) to authenticated;
