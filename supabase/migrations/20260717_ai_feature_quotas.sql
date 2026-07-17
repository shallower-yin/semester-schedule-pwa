alter table public.ai_assistant_settings
  add column if not exists feature_quotas jsonb not null default '{}'::jsonb;

alter table public.ai_assistant_usage
  add column if not exists feature_key text not null default 'assistant';

create index if not exists ai_assistant_usage_user_feature_requested_idx
on public.ai_assistant_usage (user_id, feature_key, requested_at desc);

alter table public.ai_assistant_settings
  drop constraint if exists ai_assistant_settings_daily_limit_check,
  drop constraint if exists ai_assistant_settings_weekly_limit_check,
  drop constraint if exists ai_assistant_settings_ordinary_daily_limit_check,
  drop constraint if exists ai_assistant_settings_ordinary_weekly_limit_check,
  drop constraint if exists ai_assistant_settings_member_daily_limit_check,
  drop constraint if exists ai_assistant_settings_member_weekly_limit_check;

alter table public.ai_assistant_settings
  add constraint ai_assistant_settings_daily_limit_check
    check (daily_limit between 0 and 100000),
  add constraint ai_assistant_settings_weekly_limit_check
    check (weekly_limit between daily_limit and 1000000),
  add constraint ai_assistant_settings_ordinary_daily_limit_check
    check (ordinary_daily_limit between 0 and 100000),
  add constraint ai_assistant_settings_ordinary_weekly_limit_check
    check (ordinary_weekly_limit between ordinary_daily_limit and 1000000),
  add constraint ai_assistant_settings_member_daily_limit_check
    check (member_daily_limit between 0 and 100000),
  add constraint ai_assistant_settings_member_weekly_limit_check
    check (member_weekly_limit between member_daily_limit and 1000000);

update public.ai_assistant_settings
set feature_quotas = jsonb_build_object(
  'assistant', jsonb_build_object(
    'enabled_for_all', enabled_for_all,
    'ordinary_daily_limit', ordinary_daily_limit,
    'ordinary_weekly_limit', ordinary_weekly_limit,
    'member_daily_limit', member_daily_limit,
    'member_weekly_limit', member_weekly_limit
  ),
  'mind_map', jsonb_build_object(
    'enabled_for_all', enabled_for_all,
    'ordinary_daily_limit', ordinary_daily_limit,
    'ordinary_weekly_limit', ordinary_weekly_limit,
    'member_daily_limit', member_daily_limit,
    'member_weekly_limit', member_weekly_limit
  ),
  'audio_transcription', jsonb_build_object(
    'enabled_for_all', false,
    'ordinary_daily_limit', 0,
    'ordinary_weekly_limit', 0,
    'member_daily_limit', 5,
    'member_weekly_limit', 20
  )
)
where feature_quotas = '{}'::jsonb;

create or replace function public.admin_set_ai_settings(
  p_enabled_for_all boolean,
  p_ordinary_daily_limit integer,
  p_ordinary_weekly_limit integer,
  p_member_daily_limit integer,
  p_member_weekly_limit integer,
  p_provider text,
  p_model text,
  p_mimo_channel text,
  p_feature_quotas jsonb
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
  normalized_feature_quotas jsonb;
  feature_name text;
  feature_value jsonb;
  ordinary_daily integer;
  ordinary_weekly integer;
  member_daily integer;
  member_weekly integer;
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

  normalized_feature_quotas := coalesce(p_feature_quotas, '{}'::jsonb);
  foreach feature_name in array array['assistant', 'mind_map', 'audio_transcription'] loop
    feature_value := normalized_feature_quotas -> feature_name;
    if feature_value is null or jsonb_typeof(feature_value) <> 'object' then
      raise exception 'AI 功能额度配置不完整：%。', feature_name using errcode = '22023';
    end if;
    ordinary_daily := floor(coalesce((feature_value ->> 'ordinary_daily_limit')::numeric, -1));
    ordinary_weekly := floor(coalesce((feature_value ->> 'ordinary_weekly_limit')::numeric, -1));
    member_daily := floor(coalesce((feature_value ->> 'member_daily_limit')::numeric, -1));
    member_weekly := floor(coalesce((feature_value ->> 'member_weekly_limit')::numeric, -1));
    if ordinary_daily < 0 or ordinary_daily > 100000 then
      raise exception '普通用户每日额度必须在 0 到 100000 之间。' using errcode = '22023';
    end if;
    if ordinary_weekly < ordinary_daily or ordinary_weekly > 1000000 then
      raise exception '普通用户每周额度不能低于每日额度，且不能超过 1000000。' using errcode = '22023';
    end if;
    if member_daily < 0 or member_daily > 100000 then
      raise exception '会员每日额度必须在 0 到 100000 之间。' using errcode = '22023';
    end if;
    if member_weekly < member_daily or member_weekly > 1000000 then
      raise exception '会员每周额度不能低于每日额度，且不能超过 1000000。' using errcode = '22023';
    end if;
    normalized_feature_quotas := jsonb_set(
      normalized_feature_quotas,
      array[feature_name],
      jsonb_build_object(
        'enabled_for_all', coalesce((feature_value ->> 'enabled_for_all')::boolean, false),
        'ordinary_daily_limit', ordinary_daily,
        'ordinary_weekly_limit', ordinary_weekly,
        'member_daily_limit', member_daily,
        'member_weekly_limit', member_weekly
      )
    );
  end loop;

  feature_value := normalized_feature_quotas -> 'assistant';
  ordinary_daily := (feature_value ->> 'ordinary_daily_limit')::integer;
  ordinary_weekly := (feature_value ->> 'ordinary_weekly_limit')::integer;
  member_daily := (feature_value ->> 'member_daily_limit')::integer;
  member_weekly := (feature_value ->> 'member_weekly_limit')::integer;

  insert into public.ai_assistant_settings as settings (
    id, enabled_for_all, daily_limit, weekly_limit,
    ordinary_daily_limit, ordinary_weekly_limit,
    member_daily_limit, member_weekly_limit,
    provider, model, mimo_channel, feature_quotas, updated_at
  ) values (
    true, coalesce((feature_value ->> 'enabled_for_all')::boolean, p_enabled_for_all, false),
    ordinary_daily, ordinary_weekly,
    ordinary_daily, ordinary_weekly,
    member_daily, member_weekly,
    normalized_provider, normalized_model, normalized_mimo_channel,
    normalized_feature_quotas, now()
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
    feature_quotas = excluded.feature_quotas,
    updated_at = now()
  returning to_jsonb(settings.*) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text, jsonb) from public;
grant execute on function public.admin_set_ai_settings(boolean, integer, integer, integer, integer, text, text, text, jsonb) to authenticated;
