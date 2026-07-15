alter table public.ai_assistant_settings
  add column if not exists provider text not null default 'deepseek',
  add column if not exists model text not null default 'deepseek-v4-flash';

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_provider_check;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_provider_check
    check (provider in ('deepseek', 'mimo'));

drop function if exists public.admin_set_ai_settings(boolean, integer, integer, integer, integer);

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_ordinary_daily_limit integer,
  p_ordinary_weekly_limit integer,
  p_member_daily_limit integer,
  p_member_weekly_limit integer,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_model text := trim(coalesce(p_model, ''));
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;
  if normalized_provider not in ('deepseek', 'mimo') then
    raise exception 'AI 提供商只能选择 DeepSeek 或 Xiaomi MiMo。' using errcode = '22023';
  end if;
  if length(normalized_model) < 1 or length(normalized_model) > 120 then
    raise exception '模型名称长度必须在 1 到 120 个字符之间。' using errcode = '22023';
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
    member_daily_limit, member_weekly_limit,
    provider, model, updated_at
  ) values (
    true, coalesce(p_enabled_for_all, false),
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_member_daily_limit, p_member_weekly_limit,
    normalized_provider, normalized_model, now()
  )
  on conflict (id) do update set
    enabled_for_all = excluded.enabled_for_all,
    daily_limit = excluded.daily_limit,
    weekly_limit = excluded.weekly_limit,
    ordinary_daily_limit = excluded.ordinary_daily_limit,
    ordinary_weekly_limit = excluded.ordinary_weekly_limit,
    member_daily_limit = excluded.member_daily_limit,
    member_weekly_limit = excluded.member_weekly_limit,
    provider = excluded.provider,
    model = excluded.model,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text) from public;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text) to authenticated;
