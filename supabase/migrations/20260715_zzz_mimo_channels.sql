do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_assistant_settings'
      and column_name = 'mimo_channel'
  ) then
    alter table public.ai_assistant_settings
      add column mimo_channel text not null default 'payg';

    -- The existing production MiMo endpoint is a Token Plan URL, so preserve its active channel.
    update public.ai_assistant_settings
    set mimo_channel = 'token_plan'
    where provider = 'mimo';
  end if;
end;
$$;

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_mimo_channel_check;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_mimo_channel_check
  check (mimo_channel in ('payg', 'token_plan'));

drop function if exists public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text);

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_ordinary_daily_limit integer,
  p_ordinary_weekly_limit integer,
  p_member_daily_limit integer,
  p_member_weekly_limit integer,
  p_provider text,
  p_model text,
  p_mimo_channel text
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
  normalized_mimo_channel text := lower(trim(coalesce(p_mimo_channel, '')));
begin
  if not public.is_ai_assistant_admin() then
    raise exception '当前账号没有管理权限。' using errcode = '42501';
  end if;
  if normalized_provider not in ('deepseek', 'mimo') then
    raise exception 'AI 提供商只能选择 DeepSeek 或 Xiaomi MiMo。' using errcode = '22023';
  end if;
  if not (
    (normalized_provider = 'deepseek' and normalized_model in ('deepseek-v4-flash', 'deepseek-v4-pro'))
    or
    (normalized_provider = 'mimo' and normalized_model in ('mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed'))
  ) then
    raise exception '请选择当前 AI 提供商支持的模型。' using errcode = '22023';
  end if;
  if normalized_mimo_channel not in ('payg', 'token_plan') then
    raise exception 'MiMo 通道只能选择按量 API 或 Token Plan。' using errcode = '22023';
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
    provider, model, mimo_channel, updated_at
  ) values (
    true, coalesce(p_enabled_for_all, false),
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_ordinary_daily_limit, p_ordinary_weekly_limit,
    p_member_daily_limit, p_member_weekly_limit,
    normalized_provider, normalized_model, normalized_mimo_channel, now()
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
    mimo_channel = excluded.mimo_channel,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text) from public;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text) to authenticated;
